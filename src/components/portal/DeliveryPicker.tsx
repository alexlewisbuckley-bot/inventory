'use client'
import { useMemo, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Moon, Sun, Sunrise, Sunset, Truck } from 'lucide-react'
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
  const other = useRef<HTMLInputElement>(null)

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

        {/* Anything beyond two weeks, by calendar. */}
        <label
          className={`relative flex w-[74px] shrink-0 snap-start cursor-pointer flex-col items-center justify-center rounded-[12px] border border-dashed py-2 text-center transition ${
            offStrip ? 'border-transparent text-white' : 'border-black/20 bg-white text-black/55 hover:border-black/40 hover:text-black'
          }`}
          style={offStrip ? { backgroundColor: 'var(--brand)' } : undefined}
        >
          <CalendarDays className="h-4 w-4" aria-hidden />
          <span className="mt-1 text-[10.5px] font-medium leading-tight">
            {offStrip ? short(day!, { day: 'numeric', month: 'short' }) : 'Another date'}
          </span>
          <input
            ref={other}
            type="date"
            min={min}
            max={max}
            value={offStrip ? day! : ''}
            onChange={(event) => setDay(event.target.value || null)}
            onClick={() => other.current?.showPicker?.()}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Choose another delivery date"
          />
        </label>
      </div>

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
