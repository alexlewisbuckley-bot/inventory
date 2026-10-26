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
