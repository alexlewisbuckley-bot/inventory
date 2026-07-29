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
