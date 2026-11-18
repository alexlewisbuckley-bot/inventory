'use client'
import { useEffect, useRef, useState } from 'react'
import { ArrowUpDown, Check, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import {
  activeCount, buildGroups, clearTicks, pillsFor,
  type FilterState, type Filterable, type Group, type Option,
} from './filters'
import { brandFill, ui } from './ui'

/** Every filter off, leaving whatever was typed in the search. */
const clearAll = (state: FilterState): FilterState => clearTicks(state)

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
      <div className={`sticky ${offsetClass} max-h-[calc(100vh-96px)] overflow-y-auto pb-8 pr-1`}>
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-[13px] font-semibold text-black">Filters</p>
          {activeCount(state) > 0 && (
            <button
              type="button"
              onClick={() => onChange(clearAll(state))}
              className="text-[12px] text-black/45 underline underline-offset-2 hover:text-black"
            >
              Clear all
            </button>
          )}
        </div>
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
  const [find, setFind] = useState('')
  /*
   * A find box on any long group.
   *
   * Thirty brands is a list somebody reads top to bottom looking for one
   * name. Typing three letters of it is faster, and the box only appears
   * where the list is long enough to need it.
   */
  const searchable = group.options.length > SHOW_AT_FIRST
  const needle = find.trim().toLowerCase()
  const found = needle
    ? group.options.filter((option) => option.on || option.label.toLowerCase().includes(needle))
    : group.options
  const shown = all || needle ? found : found.slice(0, SHOW_AT_FIRST)
  const hidden = found.length - shown.length

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

      {searchable && (
        <label className="relative mt-2 block">
          <span className="sr-only">Find a {group.title.toLowerCase()}</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-black/30" aria-hidden />
          <input
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder={`Find ${group.title.toLowerCase()}`}
            className="h-8 w-full rounded-[8px] border border-black/10 bg-black/[0.02] pl-8 pr-2 text-[12.5px] text-black outline-none transition placeholder:text-black/35 focus:border-black/35 focus:bg-white"
          />
        </label>
      )}

      <ul className="mt-1.5">
        {shown.map((option) => (
          <li key={option.label}>
            <FilterRow option={option} onPick={() => onPick(option)} />
          </li>
        ))}
      </ul>

      {needle && found.length === 0 && (
        <p className="py-1 text-[12px] text-black/40">No match.</p>
      )}

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
      className={`group -mx-1.5 flex w-[calc(100%+12px)] items-center gap-2.5 rounded-[8px] px-1.5 py-[5px] text-left outline-none transition-colors hover:bg-black/[0.03] focus-visible:ring-2 focus-visible:ring-black/20 ${
        dead ? 'cursor-default opacity-35' : ''
      }`}
    >
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
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
            onClick={() => onChange(clearAll(state))}
            className="text-[13px] text-black/50 hover:text-black"
          >
            Clear all
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className={`ml-auto ${ui.primary}`}
          style={brandFill}
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
  const searchRef = useRef<HTMLInputElement>(null)
  const applied = activeCount(state)

  /* "/" to search, as on most shops; Escape clears what was typed. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const pills = pillsFor(items, state)
  const hasRail = buildGroups(items, state).length > 0

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-black/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-2.5 px-5 py-3.5 sm:flex-nowrap sm:px-8">
          <label className="relative w-full sm:w-auto sm:flex-1 lg:max-w-[420px]">
            <span className="sr-only">Search stock</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-black/30" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={state.q}
              onChange={(event) => onChange({ ...state, q: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onChange({ ...state, q: '' })
              }}
              placeholder="Search brand, model, reference or dial"
              className="h-11 w-full rounded-full border border-black/12 bg-black/[0.03] pl-10 pr-10 text-[14px] text-black outline-none transition placeholder:text-black/35 focus:border-black/40 focus:bg-white focus:ring-4 focus:ring-black/[0.05] [&::-webkit-search-cancel-button]:hidden"
            />
            {state.q ? (
              <button
                type="button"
                onClick={() => { onChange({ ...state, q: '' }); searchRef.current?.focus() }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-black/40 hover:bg-black/[0.06] hover:text-black"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded border border-black/15 px-1.5 text-[11px] text-black/35 lg:block">/</kbd>
            )}
          </label>

          {hasRail && (
            <button
              type="button"
              onClick={() => setSheet(true)}
              className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-full border px-4 text-[13px] sm:flex-none lg:hidden ${
                applied > 0 ? 'border-black bg-white text-black' : 'border-black/12 bg-black/[0.03] text-black/65 hover:border-black/30'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Filters
              {applied > 0 && (
                <span
                  className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white"
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
          * The applied filters, as chips, on every screen.
          *
          * The rail shows ticks, but a search term or a band chosen forty
          * watches up is out of sight by the time somebody wonders why the
          * page is short. One tap on a chip takes that one thing off.
          */}
        {pills.length > 0 && (
          <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-2 px-5 pb-3 sm:px-8">
            {pills.map((pill) => (
              <button
                key={pill.label}
                type="button"
                onClick={() => onChange({ ...state, ...pill.patch })}
                className="flex items-center gap-1.5 rounded-full border border-black/15 bg-white py-1 pl-3 pr-2 text-[12.5px] text-black/70 transition-colors hover:border-black/40 hover:text-black"
              >
                {pill.label}
                <X className="h-3 w-3" aria-hidden />
              </button>
            ))}
            {pills.length > 1 && (
              <button
                type="button"
                onClick={() => onChange({ ...clearAll(state), q: '' })}
                className="px-1 text-[12.5px] text-black/45 underline underline-offset-2 hover:text-black"
              >
                Clear all
              </button>
            )}
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

/**
 * The sort, drawn to match the search box beside it.
 *
 * A native select could not be: its arrow sat hard against the edge, it
 * rendered in the browser's own type, and it opened the operating system's
 * menu in the middle of a page that is otherwise entirely ours. This is a
 * listbox with the same height, pill and fill as the search, and a menu that
 * keeps the keyboard behaviour a select has — arrows, Enter, Escape.
 */
export function SortSelect<T extends string>({ value, options, onChange }: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (next: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const current = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open, options, value])

  const choose = (next: T) => {
    onChange(next)
    setOpen(false)
    button.current?.focus()
  }

  const onKey = (event: React.KeyboardEvent) => {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      setOpen(true)
      return
    }
    if (!open) return
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => (i + 1) % options.length) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => (i - 1 + options.length) % options.length) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(options[active]!.value) }
    else if (event.key === 'Tab') setOpen(false)
  }

  return (
    <div ref={root} className="relative min-w-0 flex-1 sm:flex-none">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sort by: ${current?.label}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        className={`flex h-11 w-full items-center gap-2.5 rounded-full border pl-4 pr-3.5 text-left text-[13.5px] text-black outline-none transition sm:w-auto sm:min-w-[210px] ${
          open
            ? 'border-black/40 bg-white ring-4 ring-black/[0.05]'
            : 'border-black/12 bg-black/[0.03] hover:border-black/30 focus-visible:border-black/40 focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-black/[0.05]'
        }`}
      >
        <ArrowUpDown className="h-4 w-4 shrink-0 text-black/35" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="hidden text-black/45 sm:inline">Sort: </span>
          <span className="font-medium">{current?.label}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-black/40 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Sort by"
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-full min-w-[230px] overflow-hidden rounded-[14px] border border-black/10 bg-white p-1.5 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.3)]"
        >
          {options.map((option, index) => {
            const on = option.value === value
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={on}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => { event.preventDefault(); choose(option.value) }}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-[13.5px] transition-colors ${
                  index === active ? 'bg-black/[0.04]' : ''
                } ${on ? 'font-semibold text-black' : 'text-black/70'}`}
              >
                {option.label}
                {on && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-white" style={brandFill}>
                    <Check className="h-3 w-3" aria-hidden />
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
