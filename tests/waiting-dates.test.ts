import { readFileSync } from 'node:fs'
import { groupUnpaidByInvoice } from '@/server/services/insights-service'
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

  it('comes back a Date, whatever the grouping does to it', () => {
    /*
     * This used to pin the text `min(...).mapWith(...)`, which is the fix
     * the aggregate needed. The grouping has since moved into TypeScript —
     * saleDate is a plain column again, so the driver parses it and the
     * aggregate hazard is gone from this query.
     *
     * The test the comment above asks for is now possible, so it is the
     * one here: ask the grouping for a date and check what comes back.
     * That holds however the query underneath is written.
     */
    const line = (id: string, on: string) => ({
      id, invoiceNo: 'INV-9', amountGbp: 1_000,
      saleDate: new Date(on), customerName: 'Chrono Hub',
    })
    const [group] = groupUnpaidByInvoice([
      line('sal_1', '2026-11-05'), line('sal_2', '2026-11-01'),
    ])
    expect(group.saleDate).toBeInstanceOf(Date)
    expect(Number.isNaN(group.saleDate.getTime())).toBe(false)
    // Waiting since its oldest line — the figure the sort below depends on.
    expect(group.saleDate).toEqual(new Date('2026-11-01'))
  })

  it('leaves no aggregate in this file unmapped', () => {
    // The class of bug, not the one instance: an aggregate typed `sql<Date>`
    // is an assertion to the compiler and a string at runtime.
    const aggregates = insights.match(/sql<Date>`[^`]*`(?!\.mapWith)/g) ?? []
    expect(aggregates).toEqual([])
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
