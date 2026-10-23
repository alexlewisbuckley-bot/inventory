import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * An aggregate over a timestamp comes back as a string.
 *
 * `sql<Date>` is a type assertion, not a conversion. A plain column is
 * parsed by the driver from its declared type; `min(sale_date)` is just an
 * expression, so the promise of a Date was kept to the compiler and broken
 * at runtime. The waiting list sorts on it, which meant `.getTime is not a
 * function` — and because that list is on Today, the whole page showed
 * "Something went wrong" rather than one card misbehaving.
 *
 * It arrived with grouping the unpaid invoices by invoice number, where
 * `sales.saleDate` stopped being a column and became `min()` of one. The
 * tests at the time were source-text guards over the grouping, and a
 * source-text guard cannot catch a value that is the wrong type.
 */
describe('a date that came out of an aggregate', () => {
  const insights = readFileSync('src/server/services/insights-service.ts', 'utf8')

  it('is mapped back to a Date at the driver boundary', () => {
    expect(insights).toMatch(/min\(\$\{sales\.saleDate\}\)`\.mapWith\(sales\.saleDate\)/)
  })

  it('is what the waiting list then sorts on', () => {
    // The line that threw. Kept in the test so the two stay tied
    // together: if the sort moves to something else, this should be
    // read again rather than quietly passing.
    expect(insights).toMatch(/a\.since\.getTime\(\) - b\.since\.getTime\(\)/)
  })

  /**
   * The others are left alone deliberately.
   *
   * Six more aggregates over timestamps exist, and they are not all
   * broken: some are normalised where they are read, some are only ever
   * formatted. Rewriting them blind to satisfy a rule would be a change
   * with no failing case behind it. This names them instead, so the next
   * person to dereference one as a Date has somewhere to start.
   */
  it('has company that has not been audited', () => {
    const suspects = [
      'src/server/services/buyback-service.ts',
      'src/server/services/brokerage-service.ts',
      'src/server/repositories/sale-repository.ts',
    ]
    for (const path of suspects) {
      expect(readFileSync(path, 'utf8')).toMatch(/sql<Date/)
    }
  })
})
