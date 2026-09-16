import { describe, expect, it } from 'vitest'
import {
  fromBase, toBase, formatCurrency, formatBase, formatBaseSigned, describeRate, describeRateFrom,
  hasRate, isCurrency, RATE_SCALE,
} from '@/lib/currency'
import { BASE_CURRENCY, DEFAULT_DISPLAY_CURRENCY } from '@/lib/enums'

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

describe('showing dollars over sterling figures', () => {
  it('reads in dollars while storing in sterling', () => {
    // The two are deliberately different constants. If they are ever made the
    // same by accident, conversion short-circuits and every figure on every
    // screen silently becomes its sterling amount behind a dollar sign.
    expect(BASE_CURRENCY).toBe('GBP')
    expect(DEFAULT_DISPLAY_CURRENCY).toBe('USD')
  })

  it('converts a stored sterling amount for display', () => {
    expect(formatBase(950_000, DEFAULT_DISPLAY_CURRENCY, RATES)).toBe('$12,635')
  })

  it('admits which currency it is in when no rate is set', () => {
    // The failure this guards. Without a USD rate the conversion is the
    // identity, so relabelling the result would print the sterling figure
    // under a dollar sign — wrong by the exchange rate and indistinguishable
    // from a correct one. Better to show sterling and look odd.
    const noUsd = { GBP: RATE_SCALE }
    expect(hasRate('USD', noUsd)).toBe(false)
    expect(formatBase(950_000, 'USD', noUsd)).toBe('£9,500')
    expect(formatBaseSigned(250_000, 'USD', noUsd)).toBe('+£2,500')
  })

  it('needs no rate for the currency it stores in', () => {
    expect(hasRate('GBP', {})).toBe(true)
    expect(formatBase(950_000, 'GBP', {})).toBe('£9,500')
  })

  it('still converts normally once a rate exists', () => {
    expect(hasRate('USD', RATES)).toBe(true)
    expect(formatBaseSigned(250_000, 'USD', RATES)).toBe('+$3,325')
  })
})

describe('rates seen from the currency you are reading in', () => {
  it('crosses two base rates rather than needing a second table', () => {
    // 1 GBP buys 1.33 USD and 4.88 AED, so a dollar buys 4.88/1.33 dirhams.
    expect(describeRateFrom('USD', 'AED', RATES)).toBe('1 USD = 3.67 AED')
    expect(describeRateFrom('USD', 'HKD', RATES)).toBe('1 USD = 7.74 HKD')
  })

  it('inverts to the base without needing a rate for it', () => {
    // The base has no row of its own — it is 1 by definition — so this is the
    // direction that breaks if the identity is not spelled out.
    expect(describeRateFrom('USD', 'GBP', RATES)).toBe('1 USD = 0.752 GBP')
    expect(describeRateFrom('GBP', 'USD', RATES)).toBe('1 GBP = 1.33 USD')
  })

  it('says nothing about a currency against itself', () => {
    expect(describeRateFrom('USD', 'USD', RATES)).toBeNull()
    expect(describeRateFrom('GBP', 'GBP', RATES)).toBeNull()
  })

  it('admits a missing rate in either direction', () => {
    const noAed = { GBP: RATE_SCALE, USD: 13_300 }
    expect(describeRateFrom('USD', 'AED', noAed)).toBe('No rate set')
    expect(describeRateFrom('AED', 'USD', noAed)).toBe('No rate set')
  })

  it('keeps enough digits for a small number to say something', () => {
    // A currency worth a tiny fraction of the one you are reading in would
    // round to "0.00" at two decimals, which is not a rate.
    expect(describeRateFrom('HKD', 'GBP', RATES)).toBe('1 HKD = 0.0971 GBP')
    expect(describeRateFrom('HKD', 'USD', RATES)).toBe('1 HKD = 0.129 USD')
  })

  it('still names the base on the screen where the base is the point', () => {
    expect(describeRate('GBP', RATES)).toBe('Base currency')
    expect(describeRate('AED', RATES)).toBe('1 GBP = 4.88 AED')
  })
})
