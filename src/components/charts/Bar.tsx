import Link from 'next/link'
import { cn } from '@/lib/cn'

export interface BarDatum {
  label: string
  value: number
  /** Printed at the end of the bar. Defaults to the number itself. */
  display?: string
  /** A second line under the label — a conversion rate, a share. */
  caption?: string
  /** The figure links to the list that produces it. */
  href?: string
  /** Chart slot 1–6. Defaults to 1; identity follows the row, never its rank. */
  slot?: 1 | 2 | 3 | 4 | 5 | 6
}

const SLOT: Record<number, string> = {
  1: 'bg-chart-1',
  2: 'bg-chart-2',
  3: 'bg-chart-3',
  4: 'bg-chart-4',
  5: 'bg-chart-5',
  6: 'bg-chart-6',
}

/**
 * Horizontal bars, labelled, in ink.
 *
 * HTML rather than SVG on purpose: these are ranked comparisons of at most a
 * dozen rows, and a div can do that with real text — selectable, zoomable,
 * translated by the browser — where an SVG would re-implement text badly.
 *
 * The rules from the design system, applied rather than restated: the value
 * is printed in ink beside the bar (text never wears the series colour), bars
 * are thin with a 2px gap, and a bar of zero still shows a hairline so "zero"
 * and "missing" cannot be confused.
 */
export function Bar({ data, max }: { data: BarDatum[]; max?: number }) {
  const peak = max ?? Math.max(...data.map((d) => d.value), 1)

  return (
    <ol className="flex flex-col gap-2.5">
      {data.map((datum) => {
        const width = peak === 0 ? 0 : Math.max(datum.value / peak, 0)
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-small font-semibold text-content-primary">
                {datum.label}
              </span>
              <span className="shrink-0 text-small font-bold tabular-nums text-content-primary">
                {datum.display ?? datum.value.toLocaleString('en-GB')}
              </span>
            </div>
            <div className="mt-1 h-2 w-full rounded-pill bg-surface-subtle">
              <div
                className={cn('h-2 rounded-pill', SLOT[datum.slot ?? 1], datum.value === 0 && 'min-w-[2px] opacity-40')}
                style={{ width: `${Math.max(width * 100, datum.value === 0 ? 0.5 : 1.5)}%` }}
              />
            </div>
            {datum.caption && (
              <p className="mt-0.5 text-caption tabular-nums text-content-secondary">{datum.caption}</p>
            )}
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
