'use client'
import { useId, useMemo, useState } from 'react'
import { Table2, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useCurrency } from '@/components/ui'
import { Table, THead, TBody, TR, TD, TH } from '@/components/ui'

export interface MonthPoint { month: string; revenue: number; profit: number; count: number }

/**
 * Monthly revenue and profit.
 *
 * Grouped (not stacked) bars: profit is a component of revenue, so stacking
 * would imply they sum. Both series are USD minor units on a single shared
 * axis — a second y-scale would let the two be visually compared when they are
 * not comparable.
 *
 * Series colours come from `--c-series-*`, validated for colour-vision
 * separation and surface contrast in both themes. Because the light-mode teal
 * sits under 3:1 against white, the chart ships a table view and on-hover
 * value labels as the required relief; identity is never carried by colour
 * alone (legend + table).
 */
export function MonthlyChart({ data }: { data: MonthPoint[] }) {
  const { money } = useCurrency()
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [hovered, setHovered] = useState<number | null>(null)
  const headingId = useId()

  const max = useMemo(
    () => Math.max(1, ...data.flatMap((d) => [d.revenue, d.profit])),
    [data],
  )

  const totals = useMemo(
    () => data.reduce((acc, d) => ({
      revenue: acc.revenue + d.revenue, profit: acc.profit + d.profit, count: acc.count + d.count,
    }), { revenue: 0, profit: 0, count: 0 }),
    [data],
  )

  return (
    <div className="px-6 py-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <ul className="flex items-center gap-5" aria-label="Legend">
          <LegendItem className="bg-series-1" label="Revenue" />
          <LegendItem className="bg-series-2" label="Profit" />
        </ul>

        <div className="inline-flex items-center gap-0.5 rounded-md border border-line-subtle p-0.5" role="group" aria-label="View as">
          <ViewButton active={view === 'chart'} onClick={() => setView('chart')} icon={<BarChart3 className="h-3.5 w-3.5" />} label="Chart" />
          <ViewButton active={view === 'table'} onClick={() => setView('table')} icon={<Table2 className="h-3.5 w-3.5" />} label="Table" />
        </div>
      </div>

      {view === 'chart' ? (
        <figure aria-labelledby={headingId}>
          <figcaption id={headingId} className="sr-only">
            Revenue and profit by month. Total revenue {money(totals.revenue)},
            total profit {money(totals.profit)} across {totals.count} sales.
          </figcaption>

          <div className="flex h-56 items-end gap-3" role="presentation">
            {data.map((point, index) => {
              const active = hovered === index
              return (
                <div
                  key={point.month}
                  className="group relative flex h-full flex-1 flex-col justify-end"
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                  tabIndex={0}
                  aria-label={`${monthLabel(point.month)}: revenue ${money(point.revenue)}, profit ${money(point.profit)}, ${point.count} sales`}
                >
                  {active && (
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-44 -translate-x-1/2 rounded-md border border-line-subtle bg-surface-raised p-3 shadow-raised"
                    >
                      <p className="text-caption font-bold text-content-primary">{monthLabel(point.month)}</p>
                      <dl className="mt-1.5 flex flex-col gap-1">
                        <TooltipRow swatch="bg-series-1" label="Revenue" value={money(point.revenue)} />
                        <TooltipRow swatch="bg-series-2" label="Profit" value={money(point.profit)} />
                      </dl>
                      <p className="mt-1.5 text-micro text-content-secondary">
                        {point.count} {point.count === 1 ? 'sale' : 'sales'}
                      </p>
                    </div>
                  )}

                  {/* 2px gap between adjacent fills; 4px rounded ends anchored
                      to the baseline. */}
                  <div className="flex h-full items-end justify-center gap-[2px]">
                    <Bar heightPct={(point.revenue / max) * 100} className="bg-series-1" dim={hovered !== null && !active} />
                    <Bar heightPct={(point.profit / max) * 100} className="bg-series-2" dim={hovered !== null && !active} />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-3 flex gap-3" aria-hidden>
            {data.map((point) => (
              <p key={point.month} className="flex-1 text-center text-micro text-content-secondary">
                {shortMonth(point.month)}
              </p>
            ))}
          </div>
        </figure>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Month</TH>
              <TH width="90px" align="right">Sales</TH>
              <TH width="130px" align="right">Revenue</TH>
              <TH width="130px" align="right">Profit</TH>
            </TR>
          </THead>
          <TBody>
            {data.map((point) => (
              <TR key={point.month}>
                <TD>{monthLabel(point.month)}</TD>
                <TD align="right">{point.count}</TD>
                <TD align="right" className="font-bold">{money(point.revenue)}</TD>
                <TD align="right" className="font-bold text-content-accent">{money(point.profit)}</TD>
              </TR>
            ))}
            <TR className="bg-surface-subtle">
              <TD className="font-bold">Total</TD>
              <TD align="right" className="font-bold">{totals.count}</TD>
              <TD align="right" className="font-bold">{money(totals.revenue)}</TD>
              <TD align="right" className="font-bold text-content-accent">{money(totals.profit)}</TD>
            </TR>
          </TBody>
        </Table>
      )}
    </div>
  )
}

function Bar({ heightPct, className, dim }: { heightPct: number; className: string; dim: boolean }) {
  return (
    <div
      className={cn(
        'w-3 rounded-t-[4px] transition-[opacity,height] duration-200',
        className,
        dim && 'opacity-45',
      )}
      style={{ height: `${Math.max(heightPct, heightPct > 0 ? 2 : 0)}%` }}
    />
  )
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={cn('h-2.5 w-2.5 rounded-xs', className)} aria-hidden />
      <span className="text-caption text-content-secondary">{label}</span>
    </li>
  )
}

function TooltipRow({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-micro text-content-secondary">
        <span className={cn('h-2 w-2 rounded-xs', swatch)} aria-hidden />
        {label}
      </dt>
      <dd className="text-micro font-bold tabular-nums text-content-primary">{value}</dd>
    </div>
  )
}

function ViewButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-caption font-semibold transition-colors',
        active ? 'bg-navy-700 text-white' : 'text-content-secondary hover:bg-surface-subtle',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

const monthLabel = (month: string): string => {
  const [year, m] = month.split('-')
  return new Date(Number(year), Number(m) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

const shortMonth = (month: string): string => {
  const [year, m] = month.split('-')
  return new Date(Number(year), Number(m) - 1, 1).toLocaleDateString('en-GB', { month: 'short' })
}
