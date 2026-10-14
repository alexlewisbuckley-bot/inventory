import { describe, expect, it } from 'vitest'
import {
  fromBase, toBase, formatCurrency, formatBase, formatBaseSigned, describeRate, describeRateFrom,
  hasRate, isCurrency, RATE_SCALE,
} from '@/lib/currency'
import { BASE_CURRENCY, DEFAULT_DISPLAY_CURRENCY } from '@/lib/enums'

/**
 * Rates as the database holds them after the base moved to dirhams: units of
 * each currency per 1 AED, scaled by 10,000. These are the exact figures
 * migration 0038 leaves behind — the old per-dollar rates multiplied by the
 * peg — so a test that passes here is testing the table the application
 * actually reads.
 *
 * The dollar has a rate of its own now, which it never had while it was the
 * base and was pinned at 1. At four decimal places the peg of 0.272294 is
 * held as 0.2723, which is where the odd penny in a dollar figure comes from.
 */
const RATES = { AED: 10_000, USD: 2_723, GBP: 2_047, HKD: 21_088 }

describe('conversion', () => {
  it('leaves base-currency amounts untouched', () => {
    expect(fromBase(33_389_170, 'AED', RATES)).toBe(33_389_170)
    expect(toBase(33_389_170, 'AED', RATES)).toBe(33_389_170)
  })

  it('converts the portfolio total out of the base into each currency', () => {
    const capital = 33_389_170 // AED 333,891.70
    expect(fromBase(capital, 'USD', RATES)).toBe(9_091_871)
    expect(fromBase(capital, 'GBP', RATES)).toBe(6_834_763)
    expect(fromBase(capital, 'HKD', RATES)).toBe(70_411_082)
  })

  it('round-trips within a penny', () => {
    for (const currency of ['USD', 'GBP', 'HKD'] as const) {
      const original = 1_310_551
      const round = toBase(fromBase(original, currency, RATES), currency, RATES)
      expect(Math.abs(round - original)).toBeLessThanOrEqual(1)
    }
  })

  it('falls back to the base amount when a rate is missing', () => {
    expect(fromBase(1000, 'USD', { AED: RATE_SCALE })).toBe(1000)
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
    expect(formatBase(33_389_170, 'USD', RATES)).toMatch(/90,919/)
    expect(formatBase(null, 'USD', RATES)).toBe('—')
  })

  it('signs profit figures', () => {
    expect(formatBaseSigned(100_000, 'GBP', RATES)).toMatch(/^\+/)
    expect(formatBaseSigned(-100_000, 'GBP', RATES)).toMatch(/^-/)
    expect(formatBaseSigned(null, 'GBP', RATES)).toBe('—')
  })

  it('describes a rate in the direction users enter it', () => {
    expect(describeRate('USD', RATES)).toBe('1 AED = 0.2723 USD')
    expect(describeRate('AED', RATES)).toBe('Base currency')
  })

  it('recognises only supported currencies', () => {
    expect(isCurrency('AED')).toBe(true)
    expect(isCurrency('EUR')).toBe(false)
    expect(isCurrency(null)).toBe(false)
  })
})

describe('dirhams as the base', () => {
  it('stores and reads in the same currency', () => {
    // The stock sits in Dubai and is bought and sold in dirhams, so the
    // everyday path converts nothing and a missing rate cannot misstate the
    // common case. They are still two separate constants: the first is what
    // the integers mean, the second is only a default anybody can change.
    expect(BASE_CURRENCY).toBe('AED')
    expect(DEFAULT_DISPLAY_CURRENCY).toBe('AED')
  })

  it('shows a stored amount as it stands', () => {
    expect(formatBase(950_000, DEFAULT_DISPLAY_CURRENCY, RATES)).toMatch(/9,500/)
  })

  it('converts out of the base for anybody reading in something else', () => {
    expect(formatBase(950_000, 'USD', RATES)).toBe('$2,587')
    expect(formatBase(950_000, 'GBP', RATES)).toBe('£1,945')
  })

  it('admits which currency it is in when no rate is set', () => {
    // Without a dollar rate, relabelling would print the dirham figure behind
    // a dollar sign — wrong by the exchange rate and indistinguishable from a
    // correct one.
    const noUsd = { AED: RATE_SCALE }
    expect(hasRate('USD', noUsd)).toBe(false)
    expect(formatBase(950_000, 'USD', noUsd)).toMatch(/9,500/)
    expect(formatBaseSigned(250_000, 'USD', noUsd)).toMatch(/^\+/)
  })

  it('needs no rate for the currency it stores in', () => {
    expect(hasRate('AED', {})).toBe(true)
    expect(formatBase(950_000, 'AED', {})).toMatch(/9,500/)
  })

  it('still converts normally once a rate exists', () => {
    expect(hasRate('GBP', RATES)).toBe(true)
    expect(formatBaseSigned(250_000, 'GBP', RATES)).toBe('+£512')
  })
})

describe('rates seen from the currency you are reading in', () => {
  it('crosses two base rates rather than needing a second table', () => {
    // A dirham buys 0.2723 dollars and 2.1088 Hong Kong dollars, so a dollar
    // buys 2.1088/0.2723 of them.
    expect(describeRateFrom('USD', 'HKD', RATES)).toBe('1 USD = 7.74 HKD')
    expect(describeRateFrom('USD', 'GBP', RATES)).toBe('1 USD = 0.752 GBP')
  })

  it('inverts to the base without needing a rate for it', () => {
    // The base has no row of its own — it is 1 by definition — so this is the
    // direction that breaks if the identity is not spelled out.
    expect(describeRateFrom('AED', 'USD', RATES)).toBe('1 AED = 0.272 USD')
    expect(describeRateFrom('USD', 'AED', RATES)).toBe('1 USD = 3.67 AED')
  })

  it('says nothing about a currency against itself', () => {
    expect(describeRateFrom('AED', 'AED', RATES)).toBeNull()
    expect(describeRateFrom('GBP', 'GBP', RATES)).toBeNull()
  })

  it('admits a missing rate in either direction', () => {
    const noUsd = { AED: RATE_SCALE, GBP: 2_047 }
    expect(describeRateFrom('GBP', 'USD', noUsd)).toBe('No rate set')
    expect(describeRateFrom('USD', 'GBP', noUsd)).toBe('No rate set')
  })

  it('keeps enough digits for a small number to say something', () => {
    // A currency worth a tiny fraction of the one you are reading in would
    // round to "0.00" at two decimals, which is not a rate.
    expect(describeRateFrom('HKD', 'GBP', RATES)).toBe('1 HKD = 0.0971 GBP')
    expect(describeRateFrom('HKD', 'USD', RATES)).toBe('1 HKD = 0.129 USD')
  })

  it('still names the base on the screen where the base is the point', () => {
    expect(describeRate('AED', RATES)).toBe('Base currency')
    expect(describeRate('USD', RATES)).toBe('1 AED = 0.2723 USD')
  })
})
