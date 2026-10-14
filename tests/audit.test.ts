import { describe, expect, it } from 'vitest'
import { changeValue } from '@/lib/audit-format'
import { diff } from '@/lib/diff'

describe('audit diffing', () => {
  const before = { model: '126711CHNR', estSaleUsd: 1865000, notes: null, status: 'IN_STOCK' }

  it('records only fields that actually changed', () => {
    const changes = diff(before, { model: '126711CHNR', estSaleUsd: 1890000 }, ['model', 'estSaleUsd'])
    expect(changes).toEqual({ estSaleUsd: { from: 1865000, to: 1890000 } })
  })

  it('returns undefined when nothing changed, so no-op saves write no audit noise', () => {
    expect(diff(before, { model: '126711CHNR' }, ['model'])).toBeUndefined()
  })

  it('ignores fields absent from the patch rather than treating them as cleared', () => {
    const changes = diff(before, { status: 'SOLD' }, ['status', 'notes'])
    expect(changes).toEqual({ status: { from: 'IN_STOCK', to: 'SOLD' } })
  })

  it('compares dates by value, not identity', () => {
    const a = { when: new Date('2026-04-08') }
    expect(diff(a, { when: new Date('2026-04-08') }, ['when'])).toBeUndefined()
    expect(diff(a, { when: new Date('2026-04-09') }, ['when'])).toBeDefined()
  })
})

/**
 * Reading the trail back.
 *
 * Somebody typed a cost into the retail cell and wanted the old figure. The
 * trail had it, and showed it as "Purchase price: 1360000 → 1456" — which is
 * thirteen thousand six hundred dollars becoming fourteen dollars fifty-six,
 * and reads as neither. The one screen whose entire purpose is being read
 * later was printing minor units.
 */
describe('reading a change back', () => {
  it('shows money as money', () => {
    expect(changeValue(1360000, 'purchasePriceGbp')).toBe('$13,600.00')
    expect(changeValue(1456, 'purchasePriceGbp')).toBe('$14.56')
  })

  it('keeps the pence', () => {
    // The mistake this screen gets opened for is usually a decimal point in
    // the wrong place, so rounding to whole units hides the evidence.
    expect(changeValue(1469559, 'estSaleUsd')).toBe('$14,695.59')
  })

  it('counts a deal’s figures as money too', () => {
    expect(changeValue(2500000, 'valueGbp')).toBe('$25,000.00')
    expect(changeValue(0, 'depositGbp')).toBe('$0.00')
  })

  it('leaves everything else exactly as it was', () => {
    // A year is not money, and a reference number of 126711 formatted as
    // $1,267.11 would be a new way of being unreadable.
    expect(changeValue(2026, 'year')).toBe('2026')
    expect(changeValue('126711CHNR', 'model')).toBe('126711CHNR')
    expect(changeValue('IN_STOCK', 'status')).toBe('In stock')
    expect(changeValue(null, 'purchasePriceGbp')).toBe('not set')
  })

  it('does not put a dollar sign on a figure that may not be dollars', () => {
    // `purchaseAmount` is minor units of whatever currency the watch was
    // bought in, which this function cannot see. A dirham amount behind a
    // dollar sign is worse than a bare integer: one is visibly unformatted,
    // the other is quietly wrong.
    expect(changeValue(5396959, 'purchaseAmount')).toBe('5396959')
  })

  it('still reads as it did when the field is not named', () => {
    // Both call sites have the field in hand, but the signature took one
    // argument for a long time and a missed call site should degrade to the
    // old behaviour rather than throw.
    expect(changeValue(1360000)).toBe('1360000')
  })
})
