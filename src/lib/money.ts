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
