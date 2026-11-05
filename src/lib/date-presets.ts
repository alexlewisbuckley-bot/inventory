import { businessToday } from './dates'

/**
 * Quick date windows for the sales ledger: "this month", "YTD" and so on.
 *
 * Each preset resolves to the same `from`/`to` pair of YYYY-MM-DD strings
 * that the two date inputs write, so a preset is not a filter of its own. It
 * fills in the range, the URL still says exactly which days are shown, and
 * changing either date by hand afterwards works as usual. "Today" is today
 * in the shop's time zone, not on the server's clock.
 */
export const DATE_PRESETS = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-3-months', label: 'Last 3 months' },
  { key: 'last-6-months', label: 'Last 6 months' },
  { key: 'ytd', label: 'YTD' },
  { key: 'last-year', label: 'Last year' },
] as const

export type DatePresetKey = (typeof DATE_PRESETS)[number]['key']

export interface DateRange { from: string; to: string }

function iso(year: number, month: number, day: number): string {
  // Date.UTC normalises an out-of-range month or day (month -1 is last
  // December, day 0 is the last day of the previous month).
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)
}

/** The same calendar day `months` earlier, clamped to the end of a short month. */
function monthsBack(year: number, month: number, day: number, months: number): string {
  const lastDay = new Date(Date.UTC(year, month - months + 1, 0)).getUTCDate()
  return iso(year, month - months, Math.min(day, lastDay))
}

export function presetRange(key: DatePresetKey, now: Date = new Date()): DateRange {
  const { year, month, day } = businessToday(now)
  const today = iso(year, month, day)
  switch (key) {
    case 'this-month':
      return { from: iso(year, month, 1), to: today }
    case 'last-month':
      return { from: iso(year, month - 1, 1), to: iso(year, month, 0) }
    case 'last-3-months':
      return { from: monthsBack(year, month, day, 3), to: today }
    case 'last-6-months':
      return { from: monthsBack(year, month, day, 6), to: today }
    case 'ytd':
      return { from: iso(year, 0, 1), to: today }
    case 'last-year':
      return { from: iso(year - 1, 0, 1), to: iso(year - 1, 11, 31) }
  }
}

/** Which preset, if any, the current from/to pair is exactly. */
export function matchPreset(from: string, to: string, now: Date = new Date()): DatePresetKey | null {
  if (!from || !to) return null
  for (const preset of DATE_PRESETS) {
    const range = presetRange(preset.key, now)
    if (range.from === from && range.to === to) return preset.key
  }
  return null
}
