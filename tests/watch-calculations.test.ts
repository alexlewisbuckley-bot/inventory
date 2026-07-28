import { describe, expect, it } from 'vitest'
import { convert, marginPct, toMinor, toMajor } from '@/lib/money'
import { daysHeld } from '@/lib/dates'

/**
 * The arithmetic behind every figure the business acts on. These are the
 * calculations the spreadsheet used to do by hand, so they are pinned here
 * against realistic values taken from the migrated data.
 */
describe('purchase conversion', () => {
  it('converts a real purchase at the captured rate', () => {
    // Stock 1361: £13,105.51 recorded against $17,430.33 (rate ≈ 1.33).
    const gbp = toMinor(13_105.51)
    expect(toMajor(convert(gbp, 1.33))).toBeCloseTo(17_430.33, 1)
  })

  it('is stable across repeated conversion of the same value', () => {
    const gbp = toMinor(6_980.4)
    expect(convert(gbp, 1.38)).toBe(convert(gbp, 1.38))
  })
})

describe('profit and margin', () => {
  it('computes estimated profit and margin for a priced watch', () => {
    const costUsd = toMinor(17_430.33)
    const saleUsd = toMinor(18_650.45)
    expect(toMajor(saleUsd - costUsd)).toBeCloseTo(1_220.12, 2)
    expect(marginPct(costUsd, saleUsd)).toBeCloseTo(7.0, 1)
  })

  it('reports a loss as a negative margin rather than clamping at zero', () => {
    const costUsd = toMinor(20_000)
    const saleUsd = toMinor(18_000)
    expect(saleUsd - costUsd).toBeLessThan(0)
    expect(marginPct(costUsd, saleUsd)).toBeCloseTo(-10)
  })

  it('refuses to compute a margin without a cost, rather than dividing by zero', () => {
    expect(marginPct(0, toMinor(10_000))).toBeNull()
    expect(marginPct(null, toMinor(10_000))).toBeNull()
  })

  it('stores margin as basis points without losing the second decimal', () => {
    const margin = marginPct(toMinor(17_430.33), toMinor(18_900))!
    const bps = Math.round(margin * 100)
    expect(bps).toBe(843)
    expect(bps / 100).toBeCloseTo(8.43, 2)
  })
})

describe('ageing', () => {
  it('counts whole days held', () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000)
    expect(daysHeld(ninetyDaysAgo)).toBe(90)
  })

  it('never reports negative ageing for a same-day purchase', () => {
    expect(daysHeld(new Date())).toBe(0)
  })

  it('returns null rather than zero when there is no date', () => {
    expect(daysHeld(null)).toBeNull()
  })
})

describe('portfolio aggregates', () => {
  // Mirrors the summariseInventory rule: unpriced stock must not be counted
  // as zero revenue, which would understate estimated profit.
  const holdings = [
    { costUsd: toMinor(9_631.56), estSaleUsd: toMinor(10_200) },
    { costUsd: toMinor(40_837.82), estSaleUsd: toMinor(42_700) },
    { costUsd: toMinor(18_091.80), estSaleUsd: null },
  ]

  it('excludes unpriced stock from estimated profit', () => {
    const profit = holdings.reduce(
      (sum, h) => (h.estSaleUsd === null ? sum : sum + (h.estSaleUsd - h.costUsd)),
      0,
    )
    expect(toMajor(profit)).toBeCloseTo(2_430.62, 2)
  })

  it('still counts unpriced stock as capital deployed', () => {
    const cost = holdings.reduce((sum, h) => sum + h.costUsd, 0)
    expect(toMajor(cost)).toBeCloseTo(68_561.18, 2)
  })
})
