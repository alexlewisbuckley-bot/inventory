import { BASE_CURRENCY, CURRENCIES, CURRENCY_SYMBOLS, type CurrencyCode } from './enums'

/**
 * Currency conversion.
 *
 * Every stored amount is GBP minor units. Rates are held as "units of X per 1
 * GBP", scaled by 10,000 so they are integers — a float rate multiplied across
 * a few hundred watches accumulates visible error in the totals.
 */
export const RATE_SCALE = 10_000

export type RateTable = Record<string, number>

/**
 * What one viewer's figures should be shown in.
 *
 * Declared here, with the conversion it feeds, so the repositories and the
 * service that resolves it share one definition rather than two that agree
 * structurally until one of them gains a field.
 */
export interface DisplayMoney {
  currency: CurrencyCode
  rates: RateTable
}

/**
 * Whether an amount can honestly be shown in this currency.
 *
 * The base needs no rate; everything else does. This matters more than it used
 * to now that the default display currency is not the base: with sterling on
 * screen a missing rate was unreachable, because the conversion short-circuits
 * for the base currency. With dollars on screen it would mean every figure in
 * the system rendered as its sterling amount behind a dollar sign — off by the
 * exchange rate, and indistinguishable from a correct one.
 */
export function hasRate(currency: CurrencyCode, rates: RateTable): boolean {
  return currency === BASE_CURRENCY || Boolean(rates[currency])
}

/** Convert GBP minor units into `currency` minor units. */
export function fromBase(baseMinor: number, currency: CurrencyCode, rates: RateTable): number {
  if (currency === BASE_CURRENCY) return baseMinor
  const rate = rates[currency]
  if (!rate) return baseMinor
  return Math.round((baseMinor * rate) / RATE_SCALE)
}

/** Convert `currency` minor units into GBP minor units. */
export function toBase(minor: number, currency: CurrencyCode, rates: RateTable): number {
  if (currency === BASE_CURRENCY) return minor
  const rate = rates[currency]
  if (!rate) return minor
  return Math.round((minor * RATE_SCALE) / rate)
}

const LOCALES: Record<CurrencyCode, string> = {
  GBP: 'en-GB', USD: 'en-US', AED: 'en-AE', HKD: 'en-HK',
}

/**
 * Format minor units already expressed in `currency`.
 *
 * AED and HKD have no widely recognised single-character symbol, so they are
 * rendered with their code — "AED 64,000" reads unambiguously where "د.إ" does
 * not for an English-speaking team.
 */
export function formatCurrency(
  minor: number | null | undefined,
  currency: CurrencyCode,
  options: { decimals?: boolean; fallback?: string } = {},
): string {
  const { decimals = false, fallback = '—' } = options
  if (minor === null || minor === undefined || Number.isNaN(minor)) return fallback
  return new Intl.NumberFormat(LOCALES[currency] ?? 'en-GB', {
    style: 'currency',
    currency,
    currencyDisplay: currency === 'AED' || currency === 'HKD' ? 'code' : 'symbol',
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(minor / 100)
}

/**
 * Format a GBP-base amount in the viewer's chosen currency.
 *
 * Falls back to showing the sterling figure under a sterling symbol when no
 * rate exists, rather than relabelling it. A number that is right with the
 * wrong label beside it is worse than one that admits which currency it is in:
 * the first is silently wrong on every screen, the second is visibly odd on
 * one and sends somebody to the rates page.
 */
export function formatBase(
  baseMinor: number | null | undefined,
  currency: CurrencyCode,
  rates: RateTable,
  options?: { decimals?: boolean; fallback?: string },
): string {
  if (baseMinor === null || baseMinor === undefined) return options?.fallback ?? '—'
  const shown = hasRate(currency, rates) ? currency : BASE_CURRENCY
  return formatCurrency(fromBase(baseMinor, shown, rates), shown, options)
}

/** Signed variant for profit figures. */
export function formatBaseSigned(
  baseMinor: number | null | undefined,
  currency: CurrencyCode,
  rates: RateTable,
): string {
  if (baseMinor === null || baseMinor === undefined) return '—'
  const shown = hasRate(currency, rates) ? currency : BASE_CURRENCY
  const converted = fromBase(baseMinor, shown, rates)
  return `${converted > 0 ? '+' : ''}${formatCurrency(converted, shown)}`
}

export function isCurrency(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value)
}

export function symbolFor(currency: CurrencyCode): string {
  return CURRENCY_SYMBOLS[currency]
}

/** Human-readable rate, e.g. "1 GBP = 4.88 AED". */
export function describeRate(currency: CurrencyCode, rates: RateTable): string {
  if (currency === BASE_CURRENCY) return 'Base currency'
  const rate = rates[currency]
  if (!rate) return 'No rate set'
  return `1 ${BASE_CURRENCY} = ${(rate / RATE_SCALE).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} ${currency}`
}
