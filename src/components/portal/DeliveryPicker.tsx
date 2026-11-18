'use client'
import { useMemo, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Moon, Sun, Sunrise, Sunset, Truck, X } from 'lucide-react'
import {
  DELIVERY_HORIZON_DAYS, DELIVERY_SLOTS, deliveryDays, dubaiToday, formatDeliveryDay, slotFor,
  type DeliverySlot,
} from '@/lib/delivery'
import { ui } from './ui'

const SLOT_ICONS: Record<DeliverySlot, typeof Sun> = {
  MORNING: Sunrise,
  MIDDAY: Sun,
  AFTERNOON: Sunset,
  EVENING: Moon,
}

const short = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' })

/**
 * When they would like it delivered: a day, then a window.
 *
 * Two weeks of days as a strip to tap through, because that is when nearly
 * every delivery is wanted, with a calendar behind "another date" for the
 * rest. The windows are four broad ones rather than hourly slots — this is a
 * request for our side to confirm on the phone, not a booking system, and a
 * three-hour window is what a courier can actually keep.
 *
 * Optional throughout. Posts `deliveryDate` and `deliverySlot`; the action
 * turns them into a line on the order's note.
 */
export function DeliveryPicker() {
  const today = useMemo(() => dubaiToday(), [])
  const days = useMemo(() => deliveryDays(today, 14), [today])
  const [day, setDay] = useState<string | null>(null)
  const [slot, setSlot] = useState<DeliverySlot | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const [calendar, setCalendar] = useState(false)

  const min = days[0]!
  const max = new Date(Date.parse(`${today}T00:00:00Z`) + DELIVERY_HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10)
  const offStrip = day !== null && !days.includes(day)
  const chosen = slotFor(slot)

  const scroll = (direction: 1 | -1) =>
    strip.current?.scrollBy({ left: direction * strip.current.clientWidth * 0.8, behavior: 'smooth' })

  return (
    <fieldset className="min-w-0 rounded-[14px] border border-black/10 bg-black/[0.015] p-4">
      <input type="hidden" name="deliveryDate" value={day ?? ''} />
      <input type="hidden" name="deliverySlot" value={day ? (slot ?? '') : ''} />

      <div className="flex items-center justify-between gap-3">
        <legend className={`${ui.label} flex items-center gap-1.5`}>
          <Truck className="h-3.5 w-3.5" aria-hidden />
          Delivery
          <span className="font-normal normal-case tracking-normal text-black/35">· optional</span>
        </legend>
        <div className="flex gap-1">
          <button type="button" onClick={() => scroll(-1)} aria-label="Earlier dates"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-white text-black/50 hover:text-black">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button type="button" onClick={() => scroll(1)} aria-label="Later dates"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-white text-black/50 hover:text-black">
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {/* The days. */}
      <div
        ref={strip}
        role="radiogroup"
        aria-label="Delivery date"
        className="-mx-1 mt-3 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {days.map((d) => {
          const on = d === day
          const weekend = [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={formatDeliveryDay(d)}
              onClick={() => setDay(on ? null : d)}
              className={`flex w-[58px] shrink-0 snap-start flex-col items-center rounded-[12px] border py-2 transition ${
                on
                  ? 'border-transparent text-white shadow-md'
                  : 'border-black/10 bg-white text-black hover:border-black/30'
              }`}
              style={on ? { backgroundColor: 'var(--brand)' } : undefined}
            >
              <span className={`text-[10.5px] font-semibold uppercase tracking-[0.1em] ${on ? 'text-white/70' : weekend ? 'text-black/35' : 'text-black/45'}`}>
                {short(d, { weekday: 'short' })}
              </span>
              <span className="mt-0.5 text-[19px] font-semibold leading-none tabular-nums">{short(d, { day: 'numeric' })}</span>
              <span className={`mt-1 text-[10.5px] ${on ? 'text-white/70' : 'text-black/40'}`}>{short(d, { month: 'short' })}</span>
            </button>
          )
        })}

        {/* Anything beyond two weeks, on our own calendar below. */}
        <button
          type="button"
          onClick={() => setCalendar((open) => !open)}
          aria-expanded={calendar}
          aria-controls="delivery-calendar"
          className={`flex w-[74px] shrink-0 snap-start flex-col items-center justify-center rounded-[12px] border py-2 text-center transition ${
            offStrip
              ? 'border-transparent text-white shadow-md'
              : calendar
                ? 'border-black/40 bg-white text-black'
                : 'border-dashed border-black/20 bg-white text-black/55 hover:border-black/40 hover:text-black'
          }`}
          style={offStrip ? { backgroundColor: 'var(--brand)' } : undefined}
        >
          <CalendarDays className="h-4 w-4" aria-hidden />
          <span className="mt-1 text-[10.5px] font-medium leading-tight">
            {offStrip ? short(day!, { day: 'numeric', month: 'short' }) : 'Another date'}
          </span>
        </button>
      </div>

      {calendar && (
        <MonthCalendar
          min={min}
          max={max}
          today={today}
          value={day}
          onPick={(picked) => { setDay(picked); setCalendar(false) }}
          onClose={() => setCalendar(false)}
        />
      )}

      {/* The window, once there is a day to put it on. */}
      <div
        role="radiogroup"
        aria-label="Delivery time"
        className={`mt-3 grid grid-cols-2 gap-2 transition-opacity sm:grid-cols-4 ${day ? '' : 'pointer-events-none opacity-40'}`}
        aria-disabled={!day}
      >
        {DELIVERY_SLOTS.map((s) => {
          const on = s.key === slot
          const Icon = SLOT_ICONS[s.key]
          return (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!day}
              onClick={() => setSlot(on ? null : s.key)}
              className={`relative flex flex-col items-start rounded-[12px] border px-3 py-2.5 text-left transition ${
                on ? 'border-transparent bg-white shadow-md ring-2' : 'border-black/10 bg-white hover:border-black/30'
              }`}
              style={on ? { ['--tw-ring-color' as string]: 'var(--brand)' } : undefined}
            >
              <Icon className="h-4 w-4 text-black/45" aria-hidden />
              <span className="mt-1.5 text-[13px] font-semibold text-black">{s.label}</span>
              <span className="text-[11.5px] tabular-nums text-black/50">{s.from}–{s.to}</span>
              {on && (
                <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: 'var(--brand)' }}>
                  <Check className="h-2.5 w-2.5" aria-hidden />
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* What will be asked for, in words, so nobody has to decode the chips. */}
      <p className="mt-3 flex min-h-[20px] items-center gap-2 text-[12.5px] text-black/60" aria-live="polite">
        {day ? (
          <>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: 'var(--brand)' }} aria-hidden />
            <span>
              <span className="font-semibold text-black">{formatDeliveryDay(day)}</span>
              {chosen ? `, ${chosen.from}–${chosen.to}` : ' · choose a time, or leave it as any time'}
            </span>
            <button type="button" onClick={() => { setDay(null); setSlot(null) }}
              className="ml-auto shrink-0 text-black/40 underline underline-offset-2 hover:text-black">
              Clear
            </button>
          </>
        ) : (
          <span className="text-black/40">Pick a day if you would like it delivered. We will confirm the time with you.</span>
        )}
      </p>
    </fieldset>
  )
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const isoOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)

/**
 * A month at a time, drawn to match the day cards above it.
 *
 * In place of the browser's own date picker, which cannot be styled and
 * looked like a different product in the middle of this dialog. Weeks start
 * on Monday; days outside the bookable window are shown but cannot be
 * chosen, so the month still reads as a month.
 */
function MonthCalendar({ min, max, today, value, onPick, onClose }: {
  min: string; max: string; today: string; value: string | null
  onPick: (day: string) => void; onClose: () => void
}) {
  const start = value && value >= min ? value : min
  const [cursor, setCursor] = useState({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 })
  const first = new Date(Date.UTC(cursor.y, cursor.m, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const inMonth = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate()
  const cells = Array.from({ length: Math.ceil((lead + inMonth) / 7) * 7 }, (_, i) => {
    const d = i - lead + 1
    return d >= 1 && d <= inMonth ? isoOf(cursor.y, cursor.m, d) : null
  })
  const monthStart = isoOf(cursor.y, cursor.m, 1)
  const canBack = monthStart > min.slice(0, 8) + '01'
  const canForward = isoOf(cursor.y, cursor.m + 1, 1) <= max
  const move = (by: number) => setCursor(({ y, m }) => {
    const next = new Date(Date.UTC(y, m + by, 1))
    return { y: next.getUTCFullYear(), m: next.getUTCMonth() }
  })

  return (
    <div id="delivery-calendar" className="mt-3 rounded-[14px] border border-black/10 bg-white p-4 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => move(-1)} disabled={!canBack} aria-label="Previous month"
          className="flex h-8 w-8 items-center justify-center rounded-full text-black/55 transition hover:bg-black/[0.05] hover:text-black disabled:opacity-25">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <p className="font-serif text-[17px] text-black" aria-live="polite">
          {first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
        </p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => move(1)} disabled={!canForward} aria-label="Next month"
            className="flex h-8 w-8 items-center justify-center rounded-full text-black/55 transition hover:bg-black/[0.05] hover:text-black disabled:opacity-25">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={onClose} aria-label="Close calendar"
            className="flex h-8 w-8 items-center justify-center rounded-full text-black/35 transition hover:bg-black/[0.05] hover:text-black">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center" role="grid">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className={`pb-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] ${i >= 5 ? 'text-black/30' : 'text-black/45'}`}>{w}</span>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <span key={i} />
          const open = cell >= min && cell <= max
          const on = cell === value
          const isToday = cell === today
          return (
            <button
              key={cell}
              type="button"
              disabled={!open}
              onClick={() => onPick(cell)}
              aria-pressed={on}
              aria-label={formatDeliveryDay(cell)}
              className={`relative flex h-10 items-center justify-center rounded-[10px] text-[13.5px] tabular-nums transition ${
                on
                  ? 'font-semibold text-white shadow-md'
                  : open
                    ? 'font-medium text-black hover:bg-black/[0.05]'
                    : 'cursor-default text-black/20'
              }`}
              style={on ? { backgroundColor: 'var(--brand)' } : undefined}
            >
              {Number(cell.slice(8))}
              {isToday && !on && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-black/35" aria-hidden />}
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-[11.5px] text-black/40">
        Bookable up to {DELIVERY_HORIZON_DAYS} days ahead. We will confirm the exact time with you.
      </p>
    </div>
  )
}
