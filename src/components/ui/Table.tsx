'use client'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Density is applied via a data attribute on the wrapper rather than threaded
 * through every cell, so a table becomes compact without any of its children
 * knowing the setting exists.
 */
export function Table({ children, className, density = 'COMFORTABLE' }: {
  children: ReactNode
  className?: string
  density?: 'COMFORTABLE' | 'COMPACT'
}) {
  return (
    <div className="w-full overflow-x-auto" data-density={density === 'COMPACT' ? 'compact' : undefined}>
      <table className={cn('w-full border-collapse text-left', className)}>{children}</table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-surface-subtle">{children}</thead>
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>
}

export function TR({ children, className, onClick, selected }: {
  children: ReactNode; className?: string; onClick?: () => void; selected?: boolean
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-line-subtle transition-colors',
        onClick && 'cursor-pointer hover:bg-surface-subtle',
        selected && 'bg-teal-100/50',
        className,
      )}
    >
      {children}
    </tr>
  )
}

export function TD({ children, className, align = 'left', ...rest }: {
  children?: ReactNode; className?: string; align?: 'left' | 'right' | 'center'; colSpan?: number
}) {
  return (
    <td
      className={cn(
        'px-4 py-3.5 text-small text-content-primary align-middle first:pl-6 last:pr-6',
        align === 'right' && 'text-right tabular-nums',
        align === 'center' && 'text-center',
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  )
}

export interface SortState { field: string; dir: 'asc' | 'desc' }

export function TH({ children, className, align = 'left', sortKey, sort, onSort, width }: {
  children?: ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
  sortKey?: string
  sort?: SortState
  onSort?: (field: string) => void
  width?: string
}) {
  const active = sortKey && sort?.field === sortKey
  const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : sortKey ? 'none' : undefined

  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      aria-sort={ariaSort}
      className={cn(
        'px-4 py-3 text-micro font-semibold uppercase tracking-wide text-content-secondary first:pl-6 last:pr-6',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {sortKey && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={cn(
            'inline-flex items-center gap-1 rounded-sm transition-colors hover:text-content-primary',
            align === 'right' && 'flex-row-reverse',
            active && 'text-content-primary',
          )}
        >
          {children}
          {active
            ? (sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)
            : <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden />}
        </button>
      ) : (
        children
      )}
    </th>
  )
}
