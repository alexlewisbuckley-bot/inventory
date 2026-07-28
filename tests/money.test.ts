import { describe, expect, it } from 'vitest'
import { toMinor, toMajor, formatMoney, formatSigned, convert, marginPct, parseMoneyInput } from '@/lib/money'

describe('money', () => {
  it('round-trips decimals through minor units without drift', () => {
    // 0.1 + 0.2 style errors are exactly what integer minor units prevent.
    expect(toMinor(13106.51)).toBe(1310651)
    expect(toMajor(1310651)).toBe(13106.51)
    expect(toMinor(0.1) + toMinor(0.2)).toBe(toMinor(0.3))
  })

  it('formats currency without decimals by default', () => {
    expect(formatMoney(1310651, 'GBP')).toBe('£13,107')
    expect(formatMoney(1310651, 'GBP', { decimals: true })).toBe('£13,106.51')
    expect(formatMoney(null)).toBe('—')
  })

  it('prefixes positive profit with a plus sign', () => {
    expect(formatSigned(122000, 'USD')).toBe('+$1,220')
    expect(formatSigned(-50000, 'USD')).toBe('-$500')
    expect(formatSigned(null)).toBe('—')
  })

  it('converts GBP to USD at the supplied rate', () => {
    expect(convert(1000000, 1.33)).toBe(1330000)
  })

  it('computes margin against cost, guarding divide-by-zero', () => {
    expect(marginPct(1000000, 1080000)).toBeCloseTo(8)
    expect(marginPct(0, 1000)).toBeNull()
    expect(marginPct(null, 1000)).toBeNull()
  })

  it('parses user input with symbols and separators', () => {
    expect(parseMoneyInput('£13,106.51')).toBe(1310651)
    expect(parseMoneyInput('$18,900')).toBe(1890000)
    expect(parseMoneyInput('')).toBeNull()
    expect(parseMoneyInput('not a number')).toBeNull()
  })
})
