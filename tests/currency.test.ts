import { describe, expect, it } from 'vitest'
import { fromBase, toBase, formatCurrency, formatBase, formatBaseSigned, describeRate, isCurrency, RATE_SCALE } from '@/lib/currency'

/** Rates as seeded: units of each currency per 1 GBP, scaled by 10,000. */
const RATES = { GBP: 10_000, USD: 13_300, AED: 48_800, HKD: 103_000 }

describe('conversion', () => {
  it('leaves base-currency amounts untouched', () => {
    expect(fromBase(25_104_639, 'GBP', RATES)).toBe(25_104_639)
    expect(toBase(25_104_639, 'GBP', RATES)).toBe(25_104_639)
  })

  it('converts the real portfolio total into each currency', () => {
    const capitalGbp = 25_104_639 // £251,046.39
    expect(fromBase(capitalGbp, 'USD', RATES)).toBe(33_389_170)
    expect(fromBase(capitalGbp, 'AED', RATES)).toBe(122_510_638)
    expect(fromBase(capitalGbp, 'HKD', RATES)).toBe(258_577_782)
  })

  it('round-trips within a penny', () => {
    for (const currency of ['USD', 'AED', 'HKD'] as const) {
      const original = 1_310_551
      const round = toBase(fromBase(original, currency, RATES), currency, RATES)
      expect(Math.abs(round - original)).toBeLessThanOrEqual(1)
    }
  })

  it('falls back to the base amount when a rate is missing', () => {
    expect(fromBase(1000, 'AED', { GBP: RATE_SCALE })).toBe(1000)
  })
})

describe('formatting', () => {
  it('uses symbols for GBP and USD, codes for AED and HKD', () => {
    expect(formatCurrency(25_104_639, 'GBP')).toContain('£')
    expect(formatCurrency(25_104_639, 'USD')).toContain('$')
    expect(formatCurrency(122_510_638, 'AED')).toContain('AED')
    expect(formatCurrency(258_577_782, 'HKD')).toContain('HKD')
  })

  it('formats a base amount in the chosen currency', () => {
    expect(formatBase(25_104_639, 'AED', RATES)).toMatch(/1,225,106/)
    expect(formatBase(null, 'AED', RATES)).toBe('—')
  })

  it('signs profit figures', () => {
    expect(formatBaseSigned(100_000, 'GBP', RATES)).toMatch(/^\+/)
    expect(formatBaseSigned(-100_000, 'GBP', RATES)).toMatch(/^-/)
    expect(formatBaseSigned(null, 'GBP', RATES)).toBe('—')
  })

  it('describes a rate in the direction users enter it', () => {
    expect(describeRate('AED', RATES)).toBe('1 GBP = 4.88 AED')
    expect(describeRate('GBP', RATES)).toBe('Base currency')
  })

  it('recognises only supported currencies', () => {
    expect(isCurrency('AED')).toBe(true)
    expect(isCurrency('EUR')).toBe(false)
    expect(isCurrency(null)).toBe(false)
  })
})
