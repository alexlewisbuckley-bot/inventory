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

const trimZeros = (value: string) => value.replace(/0+$/, '').replace(/\.$/, '')

/**
 * Human-readable rate against the base, e.g. "1 GBP = 4.88 AED".
 *
 * For the rates screen, where the base is the thing you are editing against
 * and naming it is the point.
 */
export function describeRate(currency: CurrencyCode, rates: RateTable): string {
  if (currency === BASE_CURRENCY) return 'Base currency'
  const rate = rates[currency]
  if (!rate) return 'No rate set'
  return `1 ${BASE_CURRENCY} = ${trimZeros((rate / RATE_SCALE).toFixed(4))} ${currency}`
}

/**
 * The same rate, seen from whatever you are currently reading in.
 *
 * "1 GBP = 1.33 USD" is the right sentence on a settings screen and the wrong
 * one in a menu: somebody looking at dollars wants to know what a dollar buys,
 * not what a pound does. Which currency the figures happen to be stored in is
 * not their question, and answering it anyway invites the reasonable follow-up
 * of why the badge says one thing while the tick says another.
 *
 * Derived from the same table — every rate is per base, so crossing two of
 * them gives the pair — which keeps one set of numbers to maintain.
 */
export function describeRateFrom(
  from: CurrencyCode,
  to: CurrencyCode,
  rates: RateTable,
): string | null {
  if (from === to) return null
  const fromRate = from === BASE_CURRENCY ? RATE_SCALE : rates[from]
  const toRate = to === BASE_CURRENCY ? RATE_SCALE : rates[to]
  if (!fromRate || !toRate) return 'No rate set'

  const crossed = toRate / fromRate
  // Enough digits to be worth reading and no more. Two for the ordinary case,
  // a third below one so a reciprocal does not collapse to 0.75, and more only
  // where a rate would otherwise round away to nothing.
  const decimals = crossed >= 1 ? 2 : crossed >= 0.1 ? 3 : crossed >= 0.01 ? 4 : 6
  return `1 ${from} = ${trimZeros(crossed.toFixed(decimals))} ${to}`
}
