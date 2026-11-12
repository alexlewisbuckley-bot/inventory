import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard against SQLite syntax surviving in a Postgres codebase.
 *
 * The migration from SQLite left `strftime` and `unixepoch` in two hand-written
 * SQL fragments. Neither is caught by TypeScript or by the build — both failed
 * only at runtime, taking down the Reports and Users pages in production while
 * every other page looked fine. This test reads the source directly so any
 * reintroduction fails in CI.
 */
const SQLITE_ONLY = [
  /\bstrftime\s*\(/,
  /\bunixepoch\s*\(/,
  /\bjulianday\s*\(/,
  /\bAUTOINCREMENT\b/i,
  /\bPRAGMA\b/i,
  /\bsqlite_master\b/,
]

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      sourceFiles(path, acc)
    } else if (/\.(ts|tsx|sql)$/.test(entry)) {
      acc.push(path)
    }
  }
  return acc
}

/**
 * Guard against a correlated subquery that silently counts nothing.
 *
 * Drizzle renders an interpolated column unqualified — `"id"` rather than
 * `"partner_campaigns"."id"` — whenever the surrounding query has no join. In
 * a plain WHERE that is harmless. Inside a sub-SELECT it is not: the bare name
 * binds to the INNER table, so `WHERE r.campaign_id = "id"` becomes
 * `r.campaign_id = r.id`, which is false for every row.
 *
 * Nothing catches it. The types are right, the build is clean, the query
 * succeeds, and the answer is 0 — which reads as "no campaigns yet" or "this
 * customer has never bought anything". It shipped twice: once in a partner's
 * campaign counts, and once, long before, in the lifetime spend on Insights,
 * where every VIP had shown as worth nothing for months.
 *
 * The rule is therefore absolute rather than conditional: inside a sub-SELECT,
 * write the table name yourself. The queries that happen to have a join work
 * by accident, and an accident is not a thing to leave load-bearing.
 */
/** The raw `sql` template blocks in one file. */
function sqlBlocks(source: string): string[] {
  return source.match(/sql<[^>]*>`[^`]*`|sql`[^`]*`/g) ?? []
}

/**
 * The schema's own table names, read from the schema.
 *
 * Only these matter. An interpolated plain value — `${watch.brandId}` — is a
 * parameter and is exactly what a template is for; it is a Drizzle COLUMN that
 * the driver may leave unqualified. Deriving the list means this test keeps
 * working as tables are added, rather than carrying a copy that goes stale.
 */
function schemaTables(): string[] {
  const source = readFileSync(join(process.cwd(), 'src/server/db/schema.ts'), 'utf8')
  return [...source.matchAll(/export const (\w+) = pgTable\(/g)].map((m) => m[1])
}

describe('correlated subqueries', () => {
  const files = sourceFiles(join(process.cwd(), 'src')).filter((f) => f.endsWith('.ts'))
  const tables = schemaTables()

  it('finds the schema tables to check against', () => {
    expect(tables.length).toBeGreaterThan(20)
    expect(tables).toContain('watches')
  })

  it('never leave a column for the driver to qualify inside a sub-SELECT', () => {
    const column = new RegExp(`\\$\\{\\s*(${tables.join('|')})\\.\\w+\\s*\\}`)
    const offenders: string[] = []
    for (const file of files) {
      for (const block of sqlBlocks(readFileSync(file, 'utf8'))) {
        // A nested SELECT, i.e. one that is not the whole of the fragment.
        if (!/\(\s*\n?\s*(SELECT|select)\s/.test(block)) continue
        const found = block.match(column)
        if (found) {
          offenders.push(
            `${file.replace(process.cwd(), '')}: ${found[0]} — write ${found[1]}.<column> instead`,
          )
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

describe('SQL dialect', () => {
  const files = sourceFiles(join(process.cwd(), 'src'))

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('contains no SQLite-only syntax', () => {
    const offenders: string[] = []
    for (const file of files) {
      // This test names the functions it forbids, so it must exempt itself.
      if (file.endsWith('sql-dialect.test.ts')) continue
      const source = readFileSync(file, 'utf8')
      for (const pattern of SQLITE_ONLY) {
        if (pattern.test(source)) {
          offenders.push(`${file.replace(process.cwd() + '/', '')} matches ${pattern}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
