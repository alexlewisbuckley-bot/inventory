'use client'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { requestPeek, type PeekTarget } from './Peek'
import { useDensity } from './DensityProvider'

/**
 * Density is applied via a data attribute on the wrapper rather than threaded
 * through every cell, so a table becomes compact without any of its children
 * knowing the setting exists.
 */
export function Table({ children, className, density, layout = 'auto', minWidth }: {
  children: ReactNode
  className?: string
  /**
   * Row height. Left off, it follows the reader's saved preference, which is
   * the usual case — a table only states this when it has a reason to differ
   * from the rest of the application.
   */
  density?: 'COMFORTABLE' | 'COMPACT'
  /**
   * `fixed` makes the widths on `TH` authoritative.
   *
   * Under the default `auto` algorithm they are only hints, and the browser
   * overrules them by content: measured on the inventory list, not one of
   * thirteen columns came out at its stated width, and the one column meant
   * to absorb the slack — the watch itself, left deliberately elastic — was
   * squeezed to 110px while the column holding three dots was given 129.
   * That is the whole of the "big gaps": space handed to columns that had
   * nothing to put in it.
   *
   * Under `fixed` the stated widths are honoured exactly and whatever is
   * left over goes to the one column that states none. The cost is that
   * content no longer widens its column, so anything that can run long has
   * to say how it truncates.
   */
  layout?: 'auto' | 'fixed'
  /**
   * The width below which the table scrolls sideways rather than squashing.
   * Only meaningful with `fixed`: without it the stated widths are scaled
   * down proportionally on a narrow screen, which is the same crowding in a
   * smaller space.
   */
  minWidth?: string
}) {
  const preferred = useDensity()
  const applied = density ?? preferred

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
      data-density={applied === 'COMPACT' ? 'compact' : undefined}
    >
      <table
        style={minWidth ? { minWidth } : undefined}
        className={cn('w-full border-collapse text-left', layout === 'fixed' && 'table-fixed', className)}
      >
        {children}
      </table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="group/head border-b border-line-strong">{children}</thead>
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
  children?: ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
  colSpan?: number
  /** The full value, for a cell whose column is too narrow to show it all. */
  title?: string
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
        'whitespace-nowrap px-4 py-3.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-content-secondary first:pl-6 last:pr-6',
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
            // uppercase and the tracking are repeated here on purpose: the
            // base reset sets `text-transform: none` on every button, so a
            // sortable header did not inherit the treatment its neighbours
            // had and the row came out half capitals, half sentence case.
            'relative inline-flex items-center rounded-sm uppercase tracking-[0.14em] transition-colors hover:text-content-primary',
            'focus-visible:opacity-100 [&_svg]:focus-visible:opacity-40',
            active && 'text-content-primary',
          )}
        >
          {children}
          {/*
            * The sort indicator sits in the cell's padding, out of the flow.
            *
            * In the flow it reserved 16px inside every sortable header,
            * whether or not anything was showing — and once the table lays
            * out `fixed` a column can no longer widen to absorb that, so the
            * heading spilled over its own column instead: "Est. profit"
            * measured 17px wider than the column it names. It also meant the
            * heading jumped sideways the moment a column was sorted. The
            * gutter is 16px and the glyph is 12px, so it fits there without
            * reaching the next column's text.
            */}
          <span
            className={cn(
              'pointer-events-none absolute top-1/2 -translate-y-1/2',
              align === 'right' ? 'right-full mr-0.5' : 'left-full ml-0.5',
            )}
          >
            {active
              ? (sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)
              : (
                <ChevronsUpDown
                  className="h-3 w-3 opacity-0 transition-opacity group-hover/head:opacity-40"
                  aria-hidden
                />
              )}
          </span>
        </button>
      ) : (
        children
      )}
    </th>
  )
}
