import { BASE_CURRENCY, CURRENCIES, type CurrencyCode } from '@/lib/enums'
import { toBase, type RateTable } from '@/lib/currency'
import { parseMoneyInput, toMajor } from '@/lib/money'

/** The cost of one watch on a tray, as the screen collects it. */
export interface CostedLine {
  cost: string
  currency: string
}

/**
 * What a watch cost, in the base, as major units.
 *
 * Blank is a real answer: a watch whose cost is not to hand yet. A currency
 * the rate table does not know converts as one-to-one rather than throwing,
 * which is `toBase`'s own behaviour and the reason the screen shows the
 * converted figure as it is typed — a wrong rate is then visible there
 * rather than discovered in a margin report.
 */
export function costInBase(line: CostedLine, rates: RateTable): number | null {
  const minor = parseMoneyInput(line.cost)
  if (minor === null) return null
  const code = (CURRENCIES as readonly string[]).includes(line.currency)
    ? (line.currency as CurrencyCode)
    : BASE_CURRENCY
  return toMajor(toBase(minor, code, rates))
}

/**
 * Four digits, or nothing.
 *
 * The year a card's date gave, bounded: a misread "2O26" or a figure that
 * was part of the reference should leave the field blank rather than put a
 * wrong year on a record where it reads exactly like a right one.
 */
export function yearOrNull(raw: string): number | null {
  const year = Number(raw.trim())
  if (!Number.isInteger(year)) return null
  return year >= 1900 && year <= new Date().getFullYear() + 1 ? year : null
}
