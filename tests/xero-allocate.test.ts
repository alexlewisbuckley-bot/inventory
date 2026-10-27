import { describe, expect, it } from 'vitest'
import { allocate, allocationBalances } from '@/lib/xero-allocate'

const weights = (...values: number[]) => values.map((weight, i) => ({ item: `s${i}`, weight }))
const amounts = <T>(rows: Array<{ amount: number }>) => rows.map((r) => r.amount)

/**
 * Alex: "allocate the Xero total across the lines so the sum equals Xero to
 * the cent (put any rounding on the last line)."
 */
describe('splitting an invoice across its watches', () => {
  it('splits in proportion to what the watches were priced at', () => {
    expect(amounts(allocate(30_000_000, weights(20_000_000, 10_000_000))))
      .toEqual([20_000_000, 10_000_000])
  })

  it('always adds back up to the Xero total', () => {
    // A third of a cent each, three times over. Rounding each line on its
    // own loses a cent; the last line takes it instead.
    const out = allocate(100, weights(1, 1, 1))
    expect(amounts(out)).toEqual([33, 33, 34])
    expect(allocationBalances(100, out)).toBe(true)
  })

  it('puts the rounding on the last line and nowhere else', () => {
    const out = allocate(29_700_001, weights(1, 1))
    expect(amounts(out)).toEqual([14_850_001, 14_850_000])
    expect(allocationBalances(29_700_001, out)).toBe(true)
  })

  it('balances for a long invoice of odd amounts', () => {
    const total = 1_234_567
    const out = allocate(total, weights(3, 5, 7, 11, 13))
    expect(allocationBalances(total, out)).toBe(true)
    // Nobody gets a negative share out of a positive invoice.
    expect(out.every((line) => line.amount > 0)).toBe(true)
  })

  it('gives a single sale the whole invoice, untouched', () => {
    expect(amounts(allocate(29_700_001, weights(0)))).toEqual([29_700_001])
  })

  it('splits evenly when the sales say nothing about their value', () => {
    // An even split is a guess the user can see and correct. Putting the
    // whole invoice on the first line would look deliberate.
    const out = allocate(100_000, weights(0, 0, 0))
    expect(amounts(out)).toEqual([33_333, 33_333, 33_334])
    expect(allocationBalances(100_000, out)).toBe(true)
  })

  it('handles a credit note the same way', () => {
    const out = allocate(-100, weights(1, 1, 1))
    expect(allocationBalances(-100, out)).toBe(true)
    expect(amounts(out)).toEqual([-33, -33, -34])
  })

  it('returns nothing for no lines', () => {
    expect(allocate(1000, [])).toEqual([])
  })

  it('does not let a stray weight break the arithmetic', () => {
    const out = allocate(1000, [
      { item: 'a', weight: Number.NaN },
      { item: 'b', weight: -5 },
      { item: 'c', weight: 10 },
    ])
    expect(allocationBalances(1000, out)).toBe(true)
    expect(amounts(out)).toEqual([0, 0, 1000])
  })

  it('notices an allocation that does not balance', () => {
    expect(allocationBalances(100, [{ item: 'a', amount: 49 }, { item: 'b', amount: 50 }])).toBe(false)
  })
})
