'use client'

import { useId, useState } from 'react'
import { cn } from '@/lib/cn'

export interface FlowPoint {
  month: string
  label: string
  boughtCount: number
  boughtValue: string
  soldCount: number
  soldValue: string
  profitValue: string
}

/**
 * Purchases against sales, six months.
 *
 * Grouped bars rather than a line: the quantities are small integers counted
 * per month, not a continuous signal, and a line would imply values between
 * months that do not exist. Counts drive the height because "how many watches
 * moved" is the operational question; the money sits in the tooltip.
 *
 * Two series only, so the two design-system series hues are used in fixed
 * order and never cycled. Both are legended and the hovered month is labelled
 * directly, which also discharges the light-mode contrast relief the teal
 * needs against a white surface.
 */
export function StockFlowChart({ data }: { data: FlowPoint[] }) {
  const [active, setActive] = useState<string | null>(null)
  const titleId = useId()

  const max = Math.max(1, ...data.flatMap((d) => [d.boughtCount, d.soldCount]))
  // Round the axis to a sensible ceiling so the gridline reads as a real number.
  const ceiling = max <= 5 ? max : Math.ceil(max / 5) * 5
  const activePoint = data.find((d) => d.month === active) ?? null

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6">
        <Legend />
        <p className="text-caption tabular-nums text-content-secondary" aria-hidden>
          Peak {ceiling} {ceiling === 1 ? 'watch' : 'watches'}
        </p>
      </div>

      <p id={titleId} className="sr-only">
        Watches bought and sold each month for the last {data.length} months.
      </p>

      <div className="relative mt-4 px-6" role="group" aria-labelledby={titleId}>
        {/* Baseline plus a midpoint gridline — enough reference, no ruled paper. */}
        <div className="pointer-events-none absolute inset-x-6 top-0 h-[180px]" aria-hidden>
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-line-subtle" />
          <div className="absolute inset-x-0 bottom-0 border-t border-line-strong" />
        </div>

        <ul className="relative flex h-[180px] items-end gap-1.5">
          {data.map((point) => {
            const isActive = active === point.month
            return (
              <li
                key={point.month}
                className="group relative flex h-full flex-1 items-end justify-center gap-[4px]"
                onMouseEnter={() => setActive(point.month)}
                onMouseLeave={() => setActive((current) => (current === point.month ? null : current))}
              >
                {/* A full-height hit target: the bars themselves are too thin to aim at. */}
                <button
                  type="button"
                  className="absolute inset-0 z-10 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                  onFocus={() => setActive(point.month)}
                  onBlur={() => setActive((current) => (current === point.month ? null : current))}
                  aria-label={`${point.label}: bought ${point.boughtCount} (${point.boughtValue}), sold ${point.soldCount} (${point.soldValue})`}
                />
                <Bar value={point.boughtCount} ceiling={ceiling} tone="series-1" dim={active !== null && !isActive} />
                <Bar value={point.soldCount} ceiling={ceiling} tone="series-2" dim={active !== null && !isActive} />
              </li>
            )
          })}
        </ul>

        <ul className="mt-2 flex gap-1.5" aria-hidden>
          {data.map((point) => (
            <li
              key={point.month}
              className={cn(
                'flex-1 text-center text-caption',
                active === point.month ? 'font-bold text-content-primary' : 'text-content-secondary',
              )}
            >
              {point.label}
            </li>
          ))}
        </ul>
      </div>

      {/* A fixed-height readout rather than a floating tooltip: the panel never
          reflows on hover, and the figures stay readable on touch devices. */}
      <div className="mt-4 border-t border-line-subtle px-6 py-3">
        {activePoint ? (
          <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-caption text-content-secondary">{activePoint.label} bought</dt>
              <dd className="text-small font-bold tabular-nums text-content-primary">
                {activePoint.boughtCount} · {activePoint.boughtValue}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-caption text-content-secondary">Sold</dt>
              <dd className="text-small font-bold tabular-nums text-content-primary">
                {activePoint.soldCount} · {activePoint.soldValue}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-caption text-content-secondary">Profit</dt>
              <dd className="text-small font-bold tabular-nums text-content-accent">{activePoint.profitValue}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-caption text-content-secondary">Hover or focus a month for the figures behind it.</p>
        )}
      </div>
    </div>
  )
}

function Bar({ value, ceiling, tone, dim }: {
  value: number
  ceiling: number
  tone: 'series-1' | 'series-2'
  dim: boolean
}) {
  // A zero month still shows a hairline, so "nothing happened" is visibly
  // different from "no data was plotted here".
  const pct = value === 0 ? 0 : Math.max(6, (value / ceiling) * 100)
  return (
    <span
      className={cn(
        'w-full max-w-[22px] rounded-t-sm transition-[opacity,height] duration-150',
        tone === 'series-1' ? 'bg-series-1' : 'bg-series-2',
        value === 0 && 'bg-line-strong',
        dim && 'opacity-40',
      )}
      style={{ height: value === 0 ? '2px' : `${pct}%` }}
      aria-hidden
    />
  )
}

function Legend() {
  return (
    <ul className="flex items-center gap-4">
      <li className="flex items-center gap-1.5 text-caption text-content-secondary">
        <span className="h-2.5 w-2.5 rounded-sm bg-series-1" aria-hidden />
        Bought
      </li>
      <li className="flex items-center gap-1.5 text-caption text-content-secondary">
        <span className="h-2.5 w-2.5 rounded-sm bg-series-2" aria-hidden />
        Sold
      </li>
    </ul>
  )
}
