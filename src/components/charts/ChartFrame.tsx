'use client'

import { useId, useState, type ReactNode } from 'react'
import { Table2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface ChartTableRow {
  label: string
  values: Array<string | number>
}

/**
 * What every chart in the product is wrapped in.
 *
 * The frame carries the parts a chart is legally required to have and a page
 * is guaranteed to forget: the title that names the measure, the legend when
 * there is more than one series, and a table view reachable by keyboard.
 *
 * The table view is not a courtesy. A chart nobody can read is a chart nobody
 * can audit — a screen-reader user gets the same numbers everyone else gets,
 * from the same component, or the figure effectively does not exist for them.
 * It is a toggle rather than a parallel hidden table so that what is shown
 * and what is read are provably the same data.
 */
export function ChartFrame({ title, description, legend, table, children, className }: {
  title: string
  description?: string
  /** One entry per series. Omit entirely for a single series — the title names it. */
  legend?: Array<{ label: string; swatchClassName: string }>
  table: { columns: string[]; rows: ChartTableRow[] }
  children: ReactNode
  className?: string
}) {
  const [showTable, setShowTable] = useState(false)
  const id = useId()

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn('rounded-lg border border-line-subtle bg-surface-raised', className)}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line-subtle px-6 py-4">
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-small font-bold text-content-primary">{title}</h3>
          {description && (
            <p className="mt-0.5 text-caption text-content-secondary">{description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((value) => !value)}
          aria-pressed={showTable}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-2 text-caption font-semibold text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary"
        >
          <Table2 className="h-3.5 w-3.5" aria-hidden />
          {showTable ? 'Chart' : 'Table'}
        </button>
      </div>

      {legend && legend.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 px-6 pt-3" aria-hidden={showTable}>
          {legend.map((entry) => (
            <li key={entry.label} className="flex items-center gap-1.5 text-caption text-content-secondary">
              <span className={cn('h-2.5 w-2.5 rounded-xs', entry.swatchClassName)} aria-hidden />
              {entry.label}
            </li>
          ))}
        </ul>
      )}

      {showTable ? (
        <div className="overflow-x-auto px-6 py-4">
          <table className="w-full text-small">
            <thead>
              <tr className="border-b border-line-subtle text-left">
                {table.columns.map((column) => (
                  <th key={column} className="py-2 pr-4 text-micro font-semibold uppercase tracking-wide text-content-secondary">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.label} className="border-b border-line-subtle last:border-b-0">
                  <td className="py-2 pr-4 font-semibold text-content-primary">{row.label}</td>
                  {row.values.map((value, index) => (
                    <td key={index} className="py-2 pr-4 tabular-nums text-content-primary">{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-6 py-4">{children}</div>
      )}
    </section>
  )
}
