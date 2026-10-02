'use client'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, ChevronsUpDown, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { rankCandidates, type MatchCandidate } from '@/lib/photo-match'

export interface PickerWatch extends MatchCandidate {
  brandName: string
  nickname: string | null
  /** How many photographs it already has. Nought means it is probably this one. */
  photographs: number
}

interface Group {
  heading: string
  hint?: string
  items: PickerWatch[]
}

/** The panel is wider than the control, because a watch needs two lines. */
const PANEL_WIDTH = 420
const PANEL_MAX_HEIGHT = 380
/**
 * Below this there is not enough room to be worth opening downwards — about
 * three watches, which is too few to choose from without scrolling twice.
 */
const PANEL_MIN_HEIGHT = 180

/**
 * Choosing the watch a photograph belongs to.
 *
 * This replaces a native select holding every watch in stock in stock-number
 * order, which is the shape of the problem rather than a solution to it: the
 * rows that need a decision are exactly the rows where the filename said
 * nothing useful, and handing somebody forty identically-formatted Rolexes
 * asks them to already know the answer.
 *
 * So three things, in this order:
 *
 *   1. The watches the filename most looks like, even when it did not match
 *      outright — `336938.png` is one character from `336934` and that is
 *      worth putting first rather than throwing away.
 *   2. The watches already used in this batch, because seventy-three
 *      photographs are rarely seventy-three different watches.
 *   3. The watches with no photographs yet, which is what somebody adding
 *      photographs is usually working through.
 *
 * And over all of it, one search box that does not care whether you type a
 * reference, a name, a stock number or a serial.
 */
export function WatchPicker({
  watches, value, onChange, suggested, recent, label, flagged, disabled,
}: {
  watches: PickerWatch[]
  value: string | null
  onChange: (id: string) => void
  /** Ids the filename points at, best first. */
  suggested: string[]
  /** Ids chosen earlier in this batch, most recent first. */
  recent: string[]
  label: string
  /** Draw the control as needing attention. */
  flagged?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [placement, setPlacement] = useState({ above: false, maxHeight: PANEL_MAX_HEIGHT })
  const container = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const byId = useMemo(() => new Map(watches.map((w) => [w.id, w])), [watches])
  const selected = value ? byId.get(value) ?? null : null

  const groups = useMemo<Group[]>(() => {
    const term = query.trim()
    if (term) {
      // Typing collapses the groups: one ranked list, because a search result
      // split into four headings is a search result nobody can scan.
      const ranked = rankCandidates(term, watches, 40).map((r) => r.candidate)
      const seen = new Set(ranked.map((w) => w.id))
      // Ranking is about resemblance; a plain substring is about intent, and
      // somebody typing "lady" means it.
      const plain = watches.filter((w) => !seen.has(w.id) && searchText(w).includes(term.toLowerCase()))
      const items = [...ranked, ...plain]
      return items.length ? [{ heading: `${items.length} match${items.length === 1 ? '' : 'es'}`, items }] : []
    }

    const used = new Set<string>()
    const take = (ids: string[], limit: number) => {
      const out: PickerWatch[] = []
      for (const id of ids) {
        if (out.length >= limit) break
        const watch = byId.get(id)
        if (!watch || used.has(id)) continue
        used.add(id)
        out.push(watch)
      }
      return out
    }

    const result: Group[] = []
    const likely = take(suggested, 6)
    if (likely.length) {
      result.push({ heading: 'Looks like', hint: 'from the filename', items: likely })
    }
    const lastUsed = take(recent, 3)
    if (lastUsed.length) {
      result.push({ heading: 'Just used', items: lastUsed })
    }
    const bare = take(
      watches.filter((w) => w.photographs === 0).map((w) => w.id),
      likely.length ? 4 : 8,
    )
    if (bare.length) {
      result.push({ heading: 'No photographs yet', items: bare })
    }
    const rest = watches.filter((w) => !used.has(w.id))
    if (rest.length) {
      result.push({ heading: result.length ? 'All other stock' : 'Stock', items: rest })
    }
    return result
  }, [query, watches, byId, suggested, recent])

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  useEffect(() => { setActive(0) }, [query, open])

  useEffect(() => {
    if (!open) { setQuery(''); return }
    const frame = requestAnimationFrame(() => search.current?.focus())
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  /*
   * Where the panel goes, and how tall it is.
   *
   * Downwards unless there is genuinely no room — flipping on the first row
   * that cannot fit its full height puts most of a long list upwards, which
   * reads as the panel jumping about as you work down the page. So it only
   * turns over when there is less than a usable list below it and more above,
   * and otherwise it simply uses the height it has.
   */
  useLayoutEffect(() => {
    if (!open) return
    const box = container.current?.getBoundingClientRect()
    if (!box) return
    const below = window.innerHeight - box.bottom - 12
    const over = box.top - 12
    const above = below < PANEL_MIN_HEIGHT && over > below
    setPlacement({
      above,
      maxHeight: Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, above ? over : below)),
    })
  }, [open])

  // Keep the keyboard cursor in view as it moves.
  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (id: string) => { onChange(id); setOpen(false) }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!flat.length) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current) => (current + step + flat.length) % flat.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const pick = flat[active]
      if (pick) choose(pick.id)
      return
    }
    if (event.key === 'Escape' || event.key === 'Tab') setOpen(false)
  }

  return (
    <div ref={container} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className={cn(
          'flex h-9 w-[280px] items-center justify-between gap-2 rounded-sm border bg-surface-raised pl-2.5 pr-2 text-left text-small outline-none transition-colors',
          'focus-visible:border-teal-500 disabled:cursor-default disabled:opacity-70',
          flagged ? 'border-state-warning' : 'border-line-subtle hover:border-line-strong',
          selected ? 'text-content-primary' : 'text-content-secondary',
        )}
      >
        <span className="truncate">
          {selected ? <WatchLine watch={selected} /> : 'Choose a watch…'}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-content-muted" aria-hidden />
      </button>

      {open && (
        <div
          style={{ width: PANEL_WIDTH, maxHeight: placement.maxHeight }}
          className={cn(
            // Right-aligned: the control sits near the right edge of a wide
            // row, and a wider panel hanging off the left of it stays on screen.
            'absolute right-0 z-40 flex flex-col overflow-hidden rounded-md border border-line-subtle bg-surface-raised shadow-raised',
            placement.above ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line-subtle px-3">
            <Search className="h-4 w-4 shrink-0 text-content-muted" aria-hidden />
            <input
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Reference, name, stock number or serial…"
              aria-label="Search stock"
              className="w-full bg-transparent py-2.5 text-small text-content-primary outline-none placeholder:text-content-muted"
            />
          </div>

          <ul ref={list} role="listbox" aria-label={label} className="flex-1 overflow-y-auto py-1">
            {groups.map((group) => (
              <li key={group.heading}>
                <p className="flex items-baseline gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-content-muted">
                  {group.heading}
                  {group.hint && <span className="font-normal normal-case tracking-normal">{group.hint}</span>}
                </p>
                <ul>
                  {group.items.map((watch) => {
                    const index = flat.indexOf(watch)
                    return (
                      <li key={watch.id} role="option" aria-selected={watch.id === value}>
                        <button
                          type="button"
                          data-active={index === active}
                          onMouseEnter={() => setActive(index)}
                          onClick={() => choose(watch.id)}
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-1.5 text-left',
                            index === active && 'bg-surface-subtle',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-small text-content-primary">
                              <WatchLine watch={watch} />
                            </span>
                            <span className="block truncate text-caption text-content-secondary">
                              {[watch.nickname, watch.serial].filter(Boolean).join(' · ') || 'No name or serial recorded'}
                            </span>
                          </span>
                          {watch.photographs > 0 && (
                            <span className="inline-flex shrink-0 items-center gap-1 text-caption tabular-nums text-content-muted">
                              <Camera className="h-3 w-3" aria-hidden />
                              {watch.photographs}
                            </span>
                          )}
                          {watch.id === value && <Check className="h-4 w-4 shrink-0 text-content-accent" aria-hidden />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
            {flat.length === 0 && (
              <li className="px-3 py-4 text-small text-content-secondary">
                Nothing in stock matches “{query.trim()}”.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

/** One watch, named the way the inventory table names it. */
function WatchLine({ watch }: { watch: PickerWatch }) {
  return (
    <>
      <span className="tabular-nums text-content-secondary">{watch.stockNo}</span>
      {' · '}
      {watch.brandName} <span className="font-semibold">{watch.reference}</span>
    </>
  )
}

/** Everything about a watch that somebody might type into the search box. */
function searchText(watch: PickerWatch): string {
  return [watch.stockNo, watch.brandName, watch.reference, watch.nickname, watch.serial]
    .filter(Boolean).join(' ').toLowerCase()
}
