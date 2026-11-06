import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns'

export function formatDate(value: Date | string | null | undefined, fallback = '—'): string {
  const date = toDate(value)
  return date ? format(date, 'd MMM yyyy') : fallback
}

export function formatDateTime(value: Date | string | null | undefined, fallback = '—'): string {
  const date = toDate(value)
  return date ? format(date, 'd MMM yyyy, HH:mm') : fallback
}

/** Value formatted for an <input type="date"> control. */
export function toDateInput(value: Date | string | null | undefined): string {
  const date = toDate(value)
  return date ? format(date, 'yyyy-MM-dd') : ''
}

export function relativeTime(value: Date | string | null | undefined, fallback = '—'): string {
  const date = toDate(value)
  if (!date) return fallback
  // "0 seconds ago" is a sentence nobody writes. Anything inside the last few
  // seconds is, to a reader, now.
  const elapsed = Date.now() - date.getTime()
  if (Math.abs(elapsed) < 10_000) return 'Just now'
  // Anything ahead of now is a commitment, not a memory: a task due tomorrow
  // read "due 24 hours ago", which is the opposite of what it meant.
  if (elapsed < 0) return `in ${formatDistanceToNowStrict(date)}`
  return `${formatDistanceToNowStrict(date)} ago`
}

/** Whole days a watch has been held, used for ageing reports. */
export function daysHeld(purchaseDate: Date | string | null | undefined): number | null {
  const date = toDate(purchaseDate)
  if (!date) return null
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = typeof value === 'string' ? parseISO(value) : value
  return isValid(date) ? date : null
}

/**
 * The clock the business actually runs on.
 *
 * The server runs in UTC and the shop is in Dubai, four hours ahead, so for
 * the last four hours of every UTC day the two do not agree about what day
 * it is. That gap is not theoretical: a Patek sold on the shop floor was
 * booked with that day's date in Dubai, and every report that ran "up to
 * now" decided the sale had not happened yet, because by the server's clock
 * its date was still tomorrow.
 *
 * Sale dates are stored as midnight UTC of the calendar day somebody chose
 * — `z.coerce.date()` on "2026-10-27" is exactly `2026-10-27T00:00:00Z` —
 * so a window built out of UTC midnights lines up with them precisely. What
 * must not come from the server's clock is *which* day, month or year is the
 * current one. That is a question about where the business is, and the
 * answer is here.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Dubai'

/** Today's date where the shop is, as calendar parts. `month` is 0-based. */
export function businessToday(now: Date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: part('year'), month: part('month') - 1, day: part('day') }
}

/** Midnight UTC on the first of a month — the low end of a reporting window. */
export function startOfMonthUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1))
}

/**
 * The last instant of a month, in UTC.
 *
 * The high end of a window is the end of its last day and never "now". A
 * period that stops at the current instant silently drops anything dated
 * later inside it, which is a sale that exists, is on the ledger, and is
 * missing from the report of it.
 */
export function endOfMonthUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))
}

/** The last instant of one day, in UTC — the high end of a rolling window. */
export function endOfDayUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 23, 59, 59, 999))
}

export interface BusinessMonth {
  /** "2026-11", which is what a month picker puts in the URL. */
  key: string
  /** "November 2026". */
  label: string
  /** "Nov", for a chart axis. */
  short: string
  from: Date
  to: Date
}

/**
 * The last `count` months, newest first, on the business's own clock.
 *
 * One function because three reports were each building this list for
 * themselves out of `new Date()` and `new Date(year, month, 1)`, and both
 * halves of that are the server's clock rather than the shop's.
 *
 * The bounds happen to agree while the server runs in UTC. Which month is
 * *now* does not. Dubai is four hours ahead, so from midnight to 4am there
 * the server is still on the previous day — and on the first of the month
 * that is the previous *month*. A commission run opened at eight in the
 * morning in Dubai, which is four in the morning on the server, offered
 * October as "this month" and every figure on it was October's. That is
 * the report the business pays people from.
 *
 * The same fault the people report had and had fixed; it was fixed there
 * and nowhere else, which is why this is a shared function now rather than
 * a fourth copy of the arithmetic.
 */
export function recentBusinessMonths(count = 12, now: Date = new Date()): BusinessMonth[] {
  const { year, month } = businessToday(now)
  return Array.from({ length: count }, (_, index) => {
    const from = startOfMonthUtc(year, month - index)
    // Named off `from` rather than off the arithmetic again, so a month
    // that rolled back past January is labelled by what it became.
    const label = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', month: 'long', year: 'numeric',
    }).format(from)
    return {
      key: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}`,
      label,
      short: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short' }).format(from),
      from,
      to: endOfMonthUtc(year, month - index),
    }
  })
}
