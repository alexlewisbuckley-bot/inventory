import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard against a query that forgets a sale can be voided.
 *
 * There are two ways a sale stops counting — soft deletion and voiding — and a
 * query that checks only `deletedAt` reports revenue from an invoice that was
 * cancelled. Nothing catches that: the query is valid SQL, the types are fine,
 * and the number it returns looks perfectly plausible. The only tell is that
 * the totals stop agreeing with the ledger.
 *
 * Every read of the sales table must therefore go through `liveSale()`. This
 * test reads the source directly so a hand-written filter fails in CI.
 */
describe('sales filters', () => {
  const files = sourceFiles(join(process.cwd(), 'src'))

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('never filters sales on deletedAt alone', () => {
    const offenders: string[] = []

    for (const file of files) {
      // The predicate itself is the one place the raw check belongs, and this
      // test names the pattern it forbids, so both are exempt.
      if (file.endsWith('predicates.ts') || file.endsWith('sale-filters.test.ts')) continue

      const source = readFileSync(file, 'utf8')
      for (const [index, line] of source.split('\n').entries()) {
        if (!line.includes('isNull(sales.deletedAt)')) continue
        if (line.includes('isNull(sales.voidedAt)')) continue
        offenders.push(`${file.replace(process.cwd() + '/', '')}:${index + 1}`)
      }
    }

    expect(offenders).toEqual([])
  })
})

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      sourceFiles(path, acc)
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(path)
    }
  }
  return acc
}
