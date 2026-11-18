/**
 * When a partner wants their watches delivered.
 *
 * Chosen in the reserve dialog and written onto the order's note as a line
 * of plain words, so it reaches whoever fulfils it — on the held-stock list,
 * in the WhatsApp alert — without anybody having to know where else to look.
 */

export const DELIVERY_SLOTS = [
  { key: 'MORNING', label: 'Morning', from: '09:00', to: '12:00' },
  { key: 'MIDDAY', label: 'Midday', from: '12:00', to: '15:00' },
  { key: 'AFTERNOON', label: 'Afternoon', from: '15:00', to: '18:00' },
  { key: 'EVENING', label: 'Evening', from: '18:00', to: '21:00' },
] as const

export type DeliverySlot = (typeof DELIVERY_SLOTS)[number]['key']

/** How far ahead a delivery can be booked. */
export const DELIVERY_HORIZON_DAYS = 60

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86_400_000
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Today as a calendar day in Dubai, where the deliveries happen. */
export function dubaiToday(now: Date = new Date()): string {
  return iso(new Date(now.getTime() + 4 * 3_600_000))
}

/** The next `count` days a delivery can be booked for, starting tomorrow. */
export function deliveryDays(today: string, count = 14): string[] {
  const start = parse(today).getTime()
  return Array.from({ length: count }, (_, i) => iso(new Date(start + (i + 1) * DAY)))
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "Wednesday 18 November 2026" — spelled out by hand so server and browser agree. */
export function formatDeliveryDay(day: string): string {
  const d = parse(day)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function slotFor(key: string | null | undefined) {
  return DELIVERY_SLOTS.find((slot) => slot.key === key) ?? null
}

/**
 * The line that goes on the order, or null where nothing usable was chosen.
 *
 * Checked again here rather than trusted from the form: a date in the past or
 * a year out is a mistake to drop, not an instruction to carry to a driver.
 */
export function deliveryLine(day: string | null | undefined, slotKey: string | null | undefined, today: string): string | null {
  if (!day || !ISO_DAY.test(day)) return null
  const gap = (parse(day).getTime() - parse(today).getTime()) / DAY
  if (!(gap >= 1 && gap <= DELIVERY_HORIZON_DAYS)) return null
  const slot = slotFor(slotKey)
  return `Delivery: ${formatDeliveryDay(day)}${slot ? `, ${slot.from}–${slot.to} (${slot.label})` : ', any time'}`
}

/** The delivery line first, then whatever they typed. */
export function noteWithDelivery(note: string | null | undefined, line: string | null): string | null {
  const typed = note?.trim() || ''
  if (!line) return typed || null
  return typed ? `${line}\n${typed}` : line
}
