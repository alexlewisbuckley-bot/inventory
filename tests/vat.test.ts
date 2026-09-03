import { describe, expect, it } from 'vitest'
import { checkVatFormat, normaliseVatNumber, formatVatNumber } from '@/lib/vat'

/**
 * UK VAT number check digits.
 *
 * The numbers below are the ones printed on real supplier invoices read during
 * this work, which is what makes them worth testing against: they are the
 * shapes that actually arrive, and each one changed by a single digit must
 * fail. That last part is the whole point — a VAT number lifted off a scan is
 * exactly where a 6 becomes an 8.
 */
describe('normalising', () => {
  it('strips the country prefix and the spacing an invoice prints', () => {
    expect(normaliseVatNumber('GB 454 2736 86')).toBe('454273686')
    expect(normaliseVatNumber('gb454273686')).toBe('454273686')
    expect(normaliseVatNumber('454273686')).toBe('454273686')
    expect(normaliseVatNumber('VAT No. 454273686'.replace(/[^0-9]/g, ''))).toBe('454273686')
  })

  it('has nothing to say about nothing', () => {
    expect(normaliseVatNumber(null)).toBeNull()
    expect(normaliseVatNumber('')).toBeNull()
    expect(normaliseVatNumber('  ')).toBeNull()
  })
})

describe('check digits', () => {
  it('accepts the VAT numbers off real invoices', () => {
    expect(checkVatFormat('454273686').status).toBe('VALID')  // North Jewellers
    expect(checkVatFormat('435379475').status).toBe('VALID')  // MKA Acquisition
    expect(checkVatFormat('GB 435 3794 75').status).toBe('VALID')
  })

  it('rejects any one of them with a single digit changed', () => {
    // The misread this exists to catch.
    for (const wrong of ['454273687', '454273686'.replace('6', '8'), '435379476']) {
      expect(checkVatFormat(wrong).status, wrong).toBe('BAD_CHECKSUM')
    }
  })

  it('rejects a number of the wrong length rather than guessing', () => {
    expect(checkVatFormat('12345').status).toBe('WRONG_LENGTH')
    expect(checkVatFormat('4542736861234').status).toBe('WRONG_LENGTH')
  })

  it('accepts a 12-digit branch trader number on its first nine', () => {
    expect(checkVatFormat('454273686001').status).toBe('VALID')
  })

  it('says nothing at all when there is no number', () => {
    const result = checkVatFormat(null)
    expect(result.status).toBe('ABSENT')
    expect(result.message).toBeNull()
  })

  it('explains itself when it rejects, because a person has to act on it', () => {
    expect(checkVatFormat('454273687').message).toMatch(/check digits/i)
    expect(checkVatFormat('12345').message).toMatch(/nine digits/i)
  })
})

describe('formatting', () => {
  it('prints it the way HMRC does', () => {
    expect(formatVatNumber('454273686')).toBe('454 2736 86')
    expect(formatVatNumber('GB454273686')).toBe('454 2736 86')
  })

  it('leaves something too short alone rather than mangling it', () => {
    expect(formatVatNumber('1234')).toBe('1234')
    expect(formatVatNumber(null)).toBeNull()
  })
})
