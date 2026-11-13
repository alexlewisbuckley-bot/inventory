'use client'
import { useId, useMemo } from 'react'

/**
 * A two-handled range, with the stock's own distribution behind it.
 *
 * Alex: "no filtering sliders, hard to navigate — this can be so much
 * better." Price was two dropdowns of invented round numbers, which is the
 * wrong control for a range: it makes somebody read a list to answer a
 * question they would rather answer by dragging.
 *
 * The histogram is the part that earns its place. Stock is not spread evenly —
 * a case of two hundred watches is a hundred and sixty under fifty thousand
 * and a handful above three hundred — so a bare slider spends most of its
 * travel on pieces nobody is scrolling for, and somebody dragging it has no
 * idea whether they are about to cut off two watches or ninety. With the
 * distribution drawn behind it, the shape of the stock is the thing you aim
 * at.
 *
 * Built on two native range inputs rather than pointer maths: they are
 * keyboard-operable, announced properly, and respect a person's own settings
 * for how far a key press moves a control — none of which survives being
 * rewritten with mousedown handlers.
 */
export function RangeSlider({
  min, max, step, value, onChange, format, histogram, label,
}: {
  min: number
  max: number
  step: number
  value: [number, number]
  onChange: (value: [number, number]) => void
  /** How a bound is written out, e.g. as money or millimetres. */
  format: (value: number) => string
  /** One bar per bucket, 0–1, left to right. Omitted for a plain track. */
  histogram?: number[]
  label: string
}) {
  const id = useId()
  const [low, high] = value
  const span = Math.max(1, max - min)
  const leftPct = ((low - min) / span) * 100
  const rightPct = ((max - high) / span) * 100

  /*
   * Which bars fall inside the chosen range.
   *
   * Dimming the rest is what makes the histogram a readout rather than
   * decoration: the selection is legible at a glance without reading either
   * number.
   */
  const bars = useMemo(() => (histogram ?? []).map((height, index) => {
    const at = min + (span * (index + 0.5)) / Math.max(1, (histogram ?? []).length)
    return { height, inside: at >= low && at <= high }
  }), [histogram, min, span, low, high])

  /*
   * Written out literally, once, for both engines.
   *
   * Tailwind reads class names as text at build time: a variant built from a
   * template string is a class that exists at runtime and in no stylesheet,
   * so the handles come out as the browser's own and the slider looks like a
   * form control from 1998.
   */
  const THUMB = [
    '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5',
    '[&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none',
    '[&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:rounded-full',
    '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white',
    '[&::-webkit-slider-thumb]:bg-[var(--brand,#04173A)]',
    '[&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.35)]',
    // Focus shown on the handle, not as a box round the whole track.
    'focus-visible:outline-none',
    '[&:focus-visible::-webkit-slider-thumb]:ring-2',
    '[&:focus-visible::-webkit-slider-thumb]:ring-offset-2',
    '[&:focus-visible::-webkit-slider-thumb]:ring-black/60',
    '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-5',
    '[&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:appearance-none',
    '[&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full',
    '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white',
    '[&::-moz-range-thumb]:bg-[var(--brand,#04173A)]',
    '[&::-moz-range-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.35)]',
    '[&:focus-visible::-moz-range-thumb]:ring-2',
    '[&:focus-visible::-moz-range-thumb]:ring-offset-2',
    '[&:focus-visible::-moz-range-thumb]:ring-black/60',
  ].join(' ')

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.07em] text-black/45">{label}</span>
        <span className="text-[13px] tabular-nums text-black/70">
          {format(low)} – {format(high)}
        </span>
      </div>

      {bars.length > 0 && (
        <div className="mt-2.5 flex h-10 items-end gap-[2px]" aria-hidden>
          {bars.map((bar, index) => (
            <span
              key={index}
              className={`flex-1 rounded-sm transition-colors ${
                bar.height === 0
                  ? 'bg-transparent'
                  : bar.inside ? 'bg-black/35' : 'bg-black/12'
              }`}
              /*
               * A floor for a bucket that holds something, and nothing at all
               * for one that does not.
               *
               * Flooring every bar drew a grey line the width of the control
               * through price bands with no stock in them — which is the one
               * thing the histogram exists to show, reported backwards.
               */
              style={{ height: bar.height === 0 ? '2px' : `${Math.max(8, bar.height * 100)}%` }}
            />
          ))}
        </div>
      )}

      <div className="relative mt-2 h-5">
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-black/12" />
        <div
          className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full"
          style={{ left: `${leftPct}%`, right: `${rightPct}%`, backgroundColor: 'var(--brand, #04173A)' }}
        />

        {/*
          * Both inputs cover the whole track so either handle can be reached
          * anywhere, and the track itself ignores the pointer so a click
          * between them does not jump a handle somebody was not holding.
          */}
        <input
          type="range" min={min} max={max} step={step} value={low}
          aria-label={`${label}, lowest`}
          onChange={(event) => onChange(nextRange(value, 'low', Number(event.target.value)))}
          id={`${id}-low`}
          className={`pointer-events-none absolute inset-0 m-0 w-full appearance-none bg-transparent ${THUMB}`}
          // Raised when the low handle is near the top of the track, so the
          // two can still be told apart when they sit on each other.
          style={{ zIndex: low > max - span * 0.1 ? 5 : 3 }}
        />
        <input
          type="range" min={min} max={max} step={step} value={high}
          aria-label={`${label}, highest`}
          onChange={(event) => onChange(nextRange(value, 'high', Number(event.target.value)))}
          id={`${id}-high`}
          className={`pointer-events-none absolute inset-0 m-0 w-full appearance-none bg-transparent ${THUMB}`}
          style={{ zIndex: 4 }}
        />
      </div>
    </div>
  )
}

/**
 * Where a range lands when one handle is dragged.
 *
 * The one piece of real logic a two-handled slider has, so it lives here
 * rather than inline in an onChange where nothing can reach it. Handles that
 * cross invert the range and empty the list for a reason nobody can see —
 * both numbers look sensible, and the page simply says nothing matches.
 */
export function nextRange(
  current: [number, number],
  edge: 'low' | 'high',
  value: number,
): [number, number] {
  const [low, high] = current
  return edge === 'low'
    ? [Math.min(value, high), high]
    : [low, Math.max(value, low)]
}

/**
 * Bucket a set of values for the histogram, as fractions of the fullest bar.
 *
 * Relative rather than absolute, because what matters is the shape — one bar
 * twice the height of its neighbour — not how many watches tall the page can
 * draw.
 */
export function distribution(values: number[], min: number, max: number, buckets = 28): number[] {
  if (values.length === 0 || max <= min) return []
  const counts = new Array(buckets).fill(0)
  for (const value of values) {
    const at = Math.min(buckets - 1, Math.floor(((value - min) / (max - min)) * buckets))
    counts[Math.max(0, at)] += 1
  }
  const tallest = Math.max(...counts)
  return tallest === 0 ? [] : counts.map((count) => count / tallest)
}
