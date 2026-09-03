/**
 * UK VAT numbers.
 *
 * Two different questions, and only one of them can be answered offline:
 *
 *  - Is this a well-formed VAT number? A UK VRN carries a check digit, so a
 *    mistyped or misread one can be rejected instantly, for free, with no
 *    network call. That matters more than it used to now that VAT numbers are
 *    read off scanned PDFs rather than typed by somebody looking at the paper.
 *  - Does it belong to this company? Only HMRC can say, and only through their
 *    authenticated API. See `vat-check-service.ts`.
 *
 * The checksum is the cheap half and catches the common failure. It cannot
 * catch a valid number belonging to somebody else.
 */

export type VatFormat = 'VALID' | 'BAD_CHECKSUM' | 'WRONG_LENGTH' | 'ABSENT'

export interface VatFormatResult {
  status: VatFormat
  /** The number as it should be stored: digits only, no prefix or spaces. */
  normalised: string | null
  /** For showing to a person. Null when there is nothing to say. */
  message: string | null
}

/**
 * A VAT number reduced to its digits.
 *
 * Invoices write the same number as "GB 384 2910 55", "GB384291055" and
 * "384291055"; the country prefix and the spacing are presentation.
 */
export function normaliseVatNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^GB/, '')
  return cleaned.length > 0 ? cleaned : null
}

/**
 * The check digits on a UK VAT number.
 *
 * The first seven digits are weighted 8..2 and summed; the last two are the
 * check. Two schemes are in use — the original, where the total plus the check
 * is divisible by 97, and the "9755" scheme introduced when the original ran
 * out of numbers, which adds 55 first. A number is well-formed if it satisfies
 * either, which is what HMRC's own guidance says to do.
 *
 * Verified against the VAT numbers printed on real supplier invoices; a single
 * digit changed in any of them fails.
 */
export function checkVatFormat(raw: string | null | undefined): VatFormatResult {
  const normalised = normaliseVatNumber(raw)
  if (!normalised) {
    return { status: 'ABSENT', normalised: null, message: null }
  }

  // 12-digit numbers are a branch trader: the first nine are the VAT number
  // and the last three identify the branch.
  const digits = normalised.length === 12 ? normalised.slice(0, 9) : normalised

  if (!/^\d{9}$/.test(digits)) {
    return {
      status: 'WRONG_LENGTH',
      normalised,
      message: `"${raw}" is not a UK VAT number — those are nine digits, and this has ${digits.replace(/\D/g, '').length}.`,
    }
  }

  const WEIGHTS = [8, 7, 6, 5, 4, 3, 2]
  let total = 0
  for (let i = 0; i < 7; i += 1) total += Number(digits[i]) * WEIGHTS[i]!

  const check = Number(digits.slice(7))
  const original = (total + check) % 97 === 0
  const nineSevenFiveFive = (total + 55 + check) % 97 === 0

  if (original || nineSevenFiveFive) {
    return { status: 'VALID', normalised, message: null }
  }

  return {
    status: 'BAD_CHECKSUM',
    normalised,
    message: `VAT number ${normalised} fails its check digits — likely a misread or a typo.`,
  }
}

/** Formatted the way HMRC prints it: 123 4567 89. */
export function formatVatNumber(raw: string | null | undefined): string | null {
  const normalised = normaliseVatNumber(raw)
  if (!normalised || normalised.length < 9) return normalised
  return `${normalised.slice(0, 3)} ${normalised.slice(3, 7)} ${normalised.slice(7, 9)}`
    + (normalised.length > 9 ? ` ${normalised.slice(9)}` : '')
}
