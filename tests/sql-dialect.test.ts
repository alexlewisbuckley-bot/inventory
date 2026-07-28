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
