import Link from 'next/link'
import { cn } from '@/lib/cn'

export interface DivergingDatum {
  label: string
  /** Signed. Negative runs left of the zero line, positive right. */
  value: number
  /** Printed beside the bar. Defaults to the number itself. */
  display?: string
  /** The row links to the month it stands for. */
  href?: string
  /** Drawn at full strength; everything else is held back. */
  emphasis?: boolean
}

/**
 * A signed measure against a baseline — net profit, variance, a delta.
 *
 * A bar that starts at nought cannot draw a loss. Clamping one to zero
 * leaves an empty row that reads as "no data", and drawing its magnitude
 * upward states the opposite of what happened; both were on this page
 * before this component existed, and six straight loss-making months
 * rendered as six empty bars.
 *
 * So: one scale, a zero line, losses left and profits right. The zero line
 * sits where the data puts it rather than at the middle, so a run of months
 * that are all one sign uses the whole width instead of half of it, and the
 * two sides stay in the same units either way.
 */
export function DivergingBar({ data }: { data: DivergingDatum[] }) {
  const worst = Math.abs(Math.min(0, ...data.map((d) => d.value)))
  const best = Math.max(0, ...data.map((d) => d.value))
  const span = worst + best
  // Everything at nought: draw the line in the middle rather than divide
  // by zero, and every row is then a hairline on it, which is the truth.
  const zeroAt = span === 0 ? 50 : (worst / span) * 100

  return (
    <ol className="flex flex-col gap-2.5">
      {data.map((datum) => {
        const width = span === 0 ? 0 : (Math.abs(datum.value) / span) * 100
        const loss = datum.value < 0
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-small font-semibold text-content-primary">
                {datum.label}
              </span>
              <span className={cn(
                'shrink-0 text-small font-bold tabular-nums',
                loss ? 'text-state-danger' : 'text-content-primary',
              )}>
                {datum.display ?? datum.value.toLocaleString('en-GB')}
              </span>
            </div>
            <div className="relative mt-1 h-2 w-full">
              {/* Solid hairline, one shade off the surface. Dashing it would
                  read as a projection rather than as the baseline. */}
              <span
                aria-hidden
                className="absolute inset-y-[-3px] w-px bg-line-strong"
                style={{ left: `${zeroAt}%` }}
              />
              <div
                className={cn(
                  'absolute h-2 rounded-pill',
                  loss ? 'bg-chart-div-1' : 'bg-chart-div-5',
                  !datum.emphasis && 'opacity-45',
                  // A month that broke exactly even is not a month with no
                  // data, so it keeps a mark.
                  datum.value === 0 && 'min-w-[3px] opacity-30',
                )}
                style={loss
                  ? { right: `${100 - zeroAt}%`, width: `${width}%` }
                  : { left: `${zeroAt}%`, width: `${width}%` }}
              />
            </div>
          </>
        )

        return (
          <li key={datum.label}>
            {datum.href ? (
              <Link
                href={datum.href}
                className="-mx-2 block rounded-sm px-2 py-1 transition-colors hover:bg-surface-subtle"
              >
                {body}
              </Link>
            ) : (
              <div className="py-1">{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
