'use client'
import { useState } from 'react'
import { Check, Search, SlidersHorizontal, X } from 'lucide-react'
import {
  activeCount, buildGroups, pillsFor,
  type FilterState, type Filterable, type Group, type Option,
} from './filters'

/**
 * The filter rail.
 *
 * Alex, on the panel this replaces: "This does not look neat and streamlined
 * at all ... do you really think this is world class e-commercing filtering
 * for a watch company?" He was right. It was a disclosure holding a
 * three-column grid, so the price sat in a two-column cell with nothing
 * beside it and thirteen millimetre chips wrapped into three ragged rows on
 * the other side. Every count was hidden until you opened it, and half of
 * them were wrong once you had chosen a brand.
 *
 * This is how a watch shop does it instead: a column down the left that is
 * always there, every option a row with a tick box and a live count, and the
 * stock beside it rather than under it. On a phone the same rail becomes a
 * sheet, because a column down the left of a phone is not a column.
 */

/** The rail itself, on a desktop. The sheet below renders the same groups. */
export function FilterRail({ items, state, onChange, offsetClass = 'top-[73px]' }: {
  items: Filterable[]
  state: FilterState
  onChange: (next: FilterState) => void
  /** Where the sticky column starts, which depends on the toolbar above it. */
  offsetClass?: string
}) {
  const groups = buildGroups(items, state)
  if (groups.length === 0) return null

  return (
    <aside className="hidden w-[196px] shrink-0 lg:block">
      {/*
        * Sticky, and scrollable in its own right.
        *
        * The rail is shorter than the stock beside it, so pinning it means
        * somebody forty watches down the page can still change their mind
        * without scrolling back to the top to do it.
        */}
      <div className={`sticky ${offsetClass} max-h-[calc(100vh-96px)] overflow-y-auto pb-8`}>
        <Groups groups={groups} state={state} onChange={onChange} />
      </div>
    </aside>
  )
}

function Groups({ groups, state, onChange }: {
  groups: Group[]
  state: FilterState
  onChange: (next: FilterState) => void
}) {
  return (
    <div className="divide-y divide-black/8">
      {groups.map((group) => (
        <FilterGroup
          key={group.key}
          group={group}
          onPick={(option) => onChange({ ...state, ...option.patch })}
          onClear={() => onChange({ ...state, ...group.clear })}
        />
      ))}
    </div>
  )
}

/** Past this many rows a group is a wall, so the rest wait behind one tap. */
const SHOW_AT_FIRST = 8

function FilterGroup({ group, onPick, onClear }: {
  group: Group
  onPick: (option: Option) => void
  onClear: () => void
}) {
  const [all, setAll] = useState(false)
  const shown = all ? group.options : group.options.slice(0, SHOW_AT_FIRST)
  const hidden = group.options.length - shown.length

  return (
    <div className="py-4 first:pt-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-black/40">
          {group.title}
        </h3>
        {group.active && (
          <button type="button" onClick={onClear} className="text-[11px] text-black/40 hover:text-black">
            Clear
          </button>
        )}
      </div>

      <ul className="mt-1.5">
        {shown.map((option) => (
          <li key={option.label}>
            <FilterRow option={option} onPick={() => onPick(option)} />
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-1 text-[12px] text-black/50 underline underline-offset-2 hover:text-black"
        >
          Show {hidden} more
        </button>
      )}
    </div>
  )
}

/**
 * One row: a tick box, what it is, and how many you would get.
 *
 * A row that would empty the page is dimmed and dead rather than hidden —
 * hiding it makes the rail jump about under somebody's thumb as they filter,
 * and a greyed "Patek Philippe 0" is a straight answer to "have you any".
 */
function FilterRow({ option, onPick }: { option: Option; onPick: () => void }) {
  const dead = option.count === 0 && !option.on
  return (
    <button
      type="button"
      aria-pressed={option.on}
      disabled={dead}
      onClick={onPick}
      className={`group flex w-full items-center gap-2.5 py-[5px] text-left ${
        dead ? 'cursor-default opacity-35' : ''
      }`}
    >
      <span
        aria-hidden
        className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center border transition-colors ${
          option.on ? 'border-transparent' : 'border-black/25 group-hover:border-black/60'
        }`}
        style={option.on ? { backgroundColor: 'var(--brand)' } : undefined}
      >
        {option.on && <Check className="h-[11px] w-[11px] text-white" />}
      </span>
      <span className={`flex-1 truncate text-[13px] ${
        option.on ? 'font-semibold text-black' : 'text-black/70 group-hover:text-black'
      }`}>
        {option.label}
      </span>
      <span className="shrink-0 text-[11.5px] tabular-nums text-black/35">{option.count}</span>
    </button>
  )
}

/**
 * The same rail, as a sheet, for a phone.
 *
 * Full height with the count on the button that closes it: somebody who has
 * just ticked three things wants to know what that left before they go back,
 * not after.
 */
export function FilterSheet({ items, state, onChange, resultCount, onClose }: {
  items: Filterable[]
  state: FilterState
  onChange: (next: FilterState) => void
  resultCount: number
  onClose: () => void
}) {
  const groups = buildGroups(items, state)
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
      <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
        <p className="text-[15px] font-semibold text-black">Filters</p>
        <button type="button" onClick={onClose} aria-label="Close filters" className="text-black/45 hover:text-black">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-2">
        <Groups groups={groups} state={state} onChange={onChange} />
      </div>

      <div className="flex items-center gap-3 border-t border-black/10 px-5 py-3.5">
        {activeCount(state) > 0 && (
          <button
            type="button"
            onClick={() => onChange({ ...state, brand: '', band: null, size: null, boxPapers: '' })}
            className="text-[13px] text-black/50 hover:text-black"
          >
            Clear all
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto h-11 px-6 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white"
          style={{ backgroundColor: 'var(--brand)' }}
        >
          Show {resultCount} {resultCount === 1 ? 'watch' : 'watches'}
        </button>
      </div>
    </div>
  )
}

/**
 * The bar above everything: search, what is applied, and the sort.
 *
 * Sticky, because a filtered list is something somebody changes their mind
 * about halfway down. One height for every control on it — the last version
 * had a sort carrying a floating label, so it sat lower than the box beside
 * it and the whole bar read as misaligned, which it was.
 */
export function FilterBar({ items, state, onChange, resultCount, total, children }: {
  items: Filterable[]
  state: FilterState
  onChange: (next: FilterState) => void
  resultCount: number
  total: number
  /** The sort, or anything else this page wants on the right. */
  children?: React.ReactNode
}) {
  const [sheet, setSheet] = useState(false)
  const applied = activeCount(state)
  const pills = pillsFor(items, state)
  const hasRail = buildGroups(items, state).length > 0

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-black/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1480px] items-center gap-2.5 px-5 py-3.5 sm:px-8">
          <label className="relative flex-1 lg:max-w-[360px]">
            <span className="sr-only">Search stock</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-black/30" aria-hidden />
            <input
              value={state.q}
              onChange={(event) => onChange({ ...state, q: event.target.value })}
              placeholder="Search model, reference or dial"
              className="h-11 w-full border border-black/12 bg-black/[0.02] pl-10 pr-3 text-[14px] text-black outline-none transition-colors placeholder:text-black/35 focus:border-black/45 focus:bg-white"
            />
          </label>

          {hasRail && (
            <button
              type="button"
              onClick={() => setSheet(true)}
              className={`flex h-11 shrink-0 items-center gap-2 border px-4 text-[13px] lg:hidden ${
                applied > 0 ? 'border-black text-black' : 'border-black/12 text-black/65'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Filters
              {applied > 0 && (
                <span
                  className="flex h-[18px] min-w-[18px] items-center justify-center px-1 text-[11px] font-semibold text-white"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  {applied}
                </span>
              )}
            </button>
          )}

          {/* The count, where the eye already is after typing. */}
          <p className="ml-auto hidden shrink-0 text-[13px] tabular-nums text-black/55 sm:block">
            {resultCount === total
              ? `${total} ${total === 1 ? 'watch' : 'watches'}`
              : `${resultCount} of ${total}`}
          </p>

          {children}
        </div>

        {/*
          * The applied filters, on a phone only.
          *
          * On a desktop the rail says all of this down the left-hand side, so
          * repeating it here would be two of the same control arguing.
          */}
        {pills.length > 0 && (
          <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-2 px-5 pb-3 sm:px-8 lg:hidden">
            {pills.map((pill) => (
              <button
                key={pill.label}
                type="button"
                onClick={() => onChange({ ...state, ...pill.patch })}
                className="flex items-center gap-1.5 border border-black/15 py-1 pl-2.5 pr-1.5 text-[12.5px] text-black/70"
              >
                {pill.label}
                <X className="h-3 w-3" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>

      {sheet && (
        <FilterSheet
          items={items}
          state={state}
          onChange={onChange}
          resultCount={resultCount}
          onClose={() => setSheet(false)}
        />
      )}
    </>
  )
}

/** The sort, as one control the pages fill with their own options. */
export function SortSelect<T extends string>({ value, options, onChange }: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (next: T) => void
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      aria-label="Sort by"
      className="h-11 shrink-0 border border-black/12 bg-white px-3 text-[13px] text-black outline-none transition-colors hover:border-black/30 focus:border-black/45"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}
