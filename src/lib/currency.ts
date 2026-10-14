import { BASE_CURRENCY, CURRENCIES, CURRENCY_SYMBOLS, type CurrencyCode } from './enums'

/**
 * Currency conversion.
 *
 * Every stored amount is minor units of BASE_CURRENCY, which is the dirham
 * since migration 0038. Rates are held as "units of X per 1 base", scaled by
 * 10,000 so they are integers — a float rate multiplied across a few hundred
 * watches accumulates visible error in the totals.
 *
 * Four decimal places is what that scale buys, which is worth knowing for the
 * dollar: the peg of 0.272294 is stored as 0.2723, so a dollar figure shown
 * on screen is out by about two parts in a hundred thousand. The stored
 * dirham amounts carry no such error — the conversion in 0038 was done at
 * full precision — and nothing is ever derived from a displayed figure.
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

/** Convert base minor units into `currency` minor units. */
export function fromBase(baseMinor: number, currency: CurrencyCode, rates: RateTable): number {
  if (currency === BASE_CURRENCY) return baseMinor
  const rate = rates[currency]
  if (!rate) return baseMinor
  return Math.round((baseMinor * rate) / RATE_SCALE)
}

/** Convert `currency` minor units into base minor units. */
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
 * The same money, as a spreadsheet cell format.
 *
 * An exported sheet holds real numbers carrying a currency format, not text
 * that merely looks like money. The difference is what happens when somebody
 * edits it: type 500 into a formatted column and it becomes $500.00 like the
 * cells around it, where a column of pre-formatted text leaves the new figure
 * sitting there as a bare 500 — visibly not the same kind of thing as every
 * other number in the column, and the point at which people stop trusting the
 * file.
 *
 * Symbols match `formatCurrency`, so a figure reads the same on screen and in
 * the sheet.
 */
export const EXCEL_MONEY_FORMATS: Record<CurrencyCode, string> = {
  GBP: '"£"#,##0.00',
  USD: '"$"#,##0.00',
  AED: '"AED "#,##0.00',
  HKD: '"HK$"#,##0.00',
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
 * Format a base amount in the viewer's chosen currency.
 *
 * Falls back to showing the base figure under the base currency's own mark
 * when no rate exists, rather than relabelling it. A number that is right with the
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

/**
 * Whether this currency's mark is a code rather than a symbol.
 *
 * AED and HKD have no widely recognised single character, so they are written
 * as their code — and a code behaves differently from a symbol everywhere it
 * is put next to a number. It takes a space, and it takes more room. Asked by
 * the length of the mark rather than by a list of currencies, so a fifth one
 * added later needs nothing here.
 */
export function markIsCode(currency: CurrencyCode): boolean {
  return CURRENCY_SYMBOLS[currency].length > 1
}

/**
 * The currency mark as it should sit in front of a figure.
 *
 * "$10,000" is right and "AED10,000" is a word running into a number. The
 * space is non-breaking so the two never wrap apart, which is the whole
 * reason not to write a plain one by hand at each call site.
 */
export function moneyPrefix(currency: CurrencyCode): string {
  return markIsCode(currency) ? `${CURRENCY_SYMBOLS[currency]}\u00a0` : CURRENCY_SYMBOLS[currency]
}

const trimZeros = (value: string) => value.replace(/0+$/, '').replace(/\.$/, '')

/**
 * Human-readable rate against the base, e.g. "1 AED = 0.2723 USD".
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
 * "1 AED = 0.27 USD" is the right sentence on a settings screen and the wrong
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
