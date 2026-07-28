/**
 * Monetary values are stored as integer minor units (pence / cents) to avoid
 * floating-point drift. These helpers are the only sanctioned way to convert
 * between minor units and display strings.
 */
export type Currency = 'GBP' | 'USD'

const SYMBOL: Record<Currency, string> = { GBP: '£', USD: '$' }
const LOCALE: Record<Currency, string> = { GBP: 'en-GB', USD: 'en-US' }

/** Convert a decimal amount (e.g. 13106.51) to integer minor units (1310651). */
export function toMinor(amount: number): number {
  return Math.round(amount * 100)
}

/** Convert integer minor units back to a decimal amount. */
export function toMajor(minor: number): number {
  return minor / 100
}

/** Format integer minor units as a currency string, e.g. 1310651 -> "£13,106.51". */
export function formatMoney(
  minor: number | null | undefined,
  currency: Currency = 'GBP',
  opts: { decimals?: boolean; fallback?: string } = {},
): string {
  const { decimals = false, fallback = '—' } = opts
  if (minor === null || minor === undefined || Number.isNaN(minor)) return fallback
  return new Intl.NumberFormat(LOCALE[currency], {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(toMajor(minor))
}

/** Format a signed profit figure with an explicit +/- prefix. */
export function formatSigned(minor: number | null | undefined, currency: Currency = 'USD'): string {
  if (minor === null || minor === undefined) return '—'
  const sign = minor > 0 ? '+' : ''
  return `${sign}${formatMoney(minor, currency)}`
}

/** Convert GBP minor units to USD minor units at the supplied rate. */
export function convert(minor: number, rate: number): number {
  return Math.round(minor * rate)
}

/** Margin as a percentage of cost. Returns null when cost is zero/unknown. */
export function marginPct(costMinor: number | null, saleMinor: number | null): number | null {
  if (!costMinor || !saleMinor) return null
  return ((saleMinor - costMinor) / costMinor) * 100
}

export function formatPct(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

export function currencySymbol(currency: Currency): string {
  return SYMBOL[currency]
}

/** Parse a user-entered money string ("£13,106.51", "13106.51") to minor units. */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[£$,\s]/g, '').trim()
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? toMinor(parsed) : null
}

/**
 * Group an amount as it is typed, without fighting the person typing it.
 *
 * A price of 13105.51 shown as "13105.51" is genuinely hard to read at a
 * glance, and misreading it by a factor of ten is a real mistake with real
 * money attached. Grouping the integer part fixes that, but only if the
 * formatter stays out of the way: a trailing decimal point survives so "13."
 * does not snap back to "13", digits after the point are left exactly as typed
 * so a half-entered "13.0" is not rounded to "13", and anything that is not a
 * number is returned untouched rather than silently blanked.
 */
export function formatMoneyInput(raw: string): string {
  if (!raw) return ''

  // No price in this system is negative: a cost, an asking price and a sale
  // price are all amounts. Accepting a minus sign here only defers the
  // rejection to the server, after the operator has typed the whole figure.
  const cleaned = raw.replace(/[^\d.]/g, '')
  if (!cleaned) return ''

  // Only the first decimal point counts; the rest are typos.
  const [whole, ...rest] = cleaned.split('.')
  const fraction = rest.join('').slice(0, 2)
  const hasPoint = cleaned.includes('.')

  const grouped = whole ? Number(whole).toLocaleString('en-GB') : ''

  if (!hasPoint) return grouped
  return `${grouped || '0'}.${fraction}`
}
