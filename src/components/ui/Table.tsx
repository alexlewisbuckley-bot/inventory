'use client'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { requestPeek, type PeekTarget } from './Peek'

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
    // `relative` is load-bearing, not decoration. Tailwind's `sr-only` is
    // `position: absolute`, and an absolutely-positioned descendant is only
    // clipped by an ancestor that is itself its containing block. Without this
    // the screen-reader label in the actions column resolved against the
    // viewport, sat at its static position ~950px to the right, and stretched
    // the whole document — every page with a table scrolled sideways on a
    // phone and rendered at a third of its width.
    <div
      className="relative w-full overflow-x-auto"
      data-density={density === 'COMPACT' ? 'compact' : undefined}
    >
      <table className={cn('w-full border-collapse text-left', className)}>{children}</table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="group/head bg-surface-subtle">{children}</thead>
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>
}

export function TR({ children, className, onClick, selected, peek }: {
  children: ReactNode
  className?: string
  onClick?: () => void
  selected?: boolean
  /**
   * Makes the row focusable and answers `→` with a preview of this record.
   *
   * The same key does the same thing in the command palette, which is the
   * point: one gesture for "show me that without taking me there", available
   * wherever a record is listed.
   */
  peek?: PeekTarget
}) {
  return (
    <tr
      onClick={onClick}
      tabIndex={peek ? 0 : undefined}
      onKeyDown={peek ? (event) => {
        if (event.key !== 'ArrowRight') return
        // Not while somebody is typing in a cell — an inline price editor owns
        // its own arrow keys.
        const tag = (event.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        event.preventDefault()
        requestPeek(peek)
      } : undefined}
      className={cn(
        'group/row border-b border-line-subtle transition-colors hover:bg-surface-subtle/70',
        onClick && 'cursor-pointer',
        selected && 'bg-teal-100/50 hover:bg-teal-100/60',
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
        'h-14 px-4 py-2 text-small text-content-primary align-middle first:pl-6 last:pr-6',
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
        'whitespace-nowrap px-4 py-3 text-caption font-semibold text-content-secondary first:pl-6 last:pr-6',
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
            'focus-visible:opacity-100 [&_svg]:focus-visible:opacity-40',
            align === 'right' && 'flex-row-reverse',
            active && 'text-content-primary',
          )}
        >
          {children}
          {active
            ? (sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)
            : (
              <ChevronsUpDown
                className="h-3 w-3 opacity-0 transition-opacity group-hover/head:opacity-40"
                aria-hidden
              />
            )}
        </button>
      ) : (
        children
      )}
    </th>
  )
}
