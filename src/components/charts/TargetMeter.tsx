import { cn } from '@/lib/cn'

export type MeterState = 'cleared' | 'onTrack' | 'behind'

export interface MeterDatum {
  label: string
  /** How far along, as a fraction of the target. Over 1 is allowed. */
  ratio: number
  /** Printed at the right of the row — the headline for that person. */
  display: string
  /** The line underneath: the figures the ratio is made of. */
  caption: string
  state: MeterState
  /** Said in words beside the bar, so the colour is never the only signal. */
  stateLabel: string
}

/**
 * Two fills, not three.
 *
 * The obvious scheme — green cleared, blue on track, amber behind — does not
 * survive the palette validator: the system's warning gold against its good
 * green is ΔE 12.7 for normal vision and 5.6 under protanopia, well under
 * the floor of 15, and those two states sit in adjacent rows of the same
 * column. Swapping gold for the serious orange fixes normal vision and
 * leaves protanopia at 5.2, which is the ordinary red-green trap.
 *
 * So behind-ness is carried by position instead — the fill ends short of the
 * pace mark — and by the word in the caption, both of which every reader
 * gets. What remains is one sequential hue for "not there yet" and the good
 * green for "cleared", which passes every check in both themes: ΔE 19.2
 * normal and 18.0 deutan in light, 17.1 and 12.8 in dark.
 *
 * The track is a neutral surface step rather than the sequential ramp's
 * palest, because that ramp inverts between themes: `seq-1` is a near-white
 * blue in light and a saturated navy in dark, and a saturated navy track on
 * a near-black surface reads as a full bar. A person at nought per cent
 * appeared to have hit their target. Neutral is correct in both themes and
 * is what the Bar component already uses.
 */
const FILL: Record<MeterState, string> = {
  cleared: 'bg-state-good',
  onTrack: 'bg-chart-seq-4',
  behind: 'bg-chart-seq-4',
}

/**
 * One ratio against one limit, per row: profit against the retainer it has
 * to clear before any commission is earned.
 *
 * A meter rather than a bar chart, because the comparison that matters is
 * each person against their own target and not against each other — two
 * people on different retainers are not racing, and a shared axis would
 * say they were. Every track is therefore the same length and reads as
 * "nought to your own hundred per cent", which is also what makes the
 * column scannable: one vertical line at the right-hand end is the only
 * place a reader has to look to see who has cleared.
 *
 * Past that line the magnitude stops being the question, so the bar simply
 * fills and the commission is printed instead of extending a tail nobody
 * would measure.
 */
export function TargetMeter({ data, pace }: {
  data: MeterDatum[]
  /**
   * How far through the month we are, 0–1, drawn as a mark on every track.
   *
   * Without it a meter read on the 3rd is indistinguishable from the same
   * meter read on the 30th, and every row looks like a failure for the
   * first three weeks of every month. Omitted for a month already over,
   * where the whole track is the deadline.
   */
  pace?: number
}) {
  return (
    <ol className="flex flex-col gap-4">
      {data.map((datum) => {
        const width = Math.min(Math.max(datum.ratio, 0), 1) * 100
        return (
          <li key={datum.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-small font-semibold text-content-primary">
                {datum.label}
              </span>
              <span className="shrink-0 text-small font-bold tabular-nums text-content-primary">
                {datum.display}
              </span>
            </div>

            <div className="relative mt-1.5 h-2 w-full rounded-pill bg-surface-subtle">
              <div
                className={cn(
                  'h-2 rounded-pill',
                  FILL[datum.state],
                  // A hairline rather than nothing, so a month with no
                  // profit is visibly zero and not visibly broken.
                  width === 0 && 'min-w-[3px] opacity-50',
                )}
                style={{ width: `${width}%` }}
              />
              {pace !== undefined && pace > 0 && pace < 1 && (
                <span
                  aria-hidden
                  // Overhangs the track, and wears a surface ring because it
                  // sits on top of the fill.
                  className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-pill bg-content-secondary ring-2 ring-surface-raised"
                  style={{ left: `calc(${pace * 100}% - 1px)` }}
                />
              )}
            </div>

            <p className="mt-1 text-caption text-content-secondary">
              <span className="font-semibold text-content-primary">{datum.stateLabel}</span>
              {' · '}
              {datum.caption}
            </p>
          </li>
        )
      })}
    </ol>
  )
}
