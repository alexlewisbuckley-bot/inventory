'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { applyFilters, parseFilters, WATCH_FIELDS, type FilterClause } from '@/lib/filters'
import { useCurrency } from '@/components/ui/CurrencyProvider'
import { fromBase } from '@/lib/currency'
import { CURRENCY_SYMBOLS } from '@/lib/enums'
import type { FacetOption, RangeFacet, StockFacetData } from '@/server/repositories/watch-repository'

/**
 * Finding one watch in a caseful of them.
 *
 * The version before this was five stacked rows of chips, and with real stock
 * behind it — a hundred and eighteen Rolexes, thirty-two model families — it
 * was a wall. Two hundred pixels of chrome before the first watch, a "24
 * more" link doing the work a scrollbar should, and budget reduced to four
 * fixed brackets when what a customer says is "about fifteen". Every answer
 * shouted at once, none of it reachable quickly.
 *
 * So: one row, five controls, each closed until it is asked a question.
 *
 *   Brand ▾   Model ▾   Budget ▾   Size ▾   For ▾        118 watches
 *
 * A trigger carries its own answer — "Rolex", "2 brands" — so the row reads
 * as the current question even while every menu is shut, and the whole thing
 * costs one line instead of five.
 *
 * Brand and model open a list you can type into, because thirty-two families
 * is a scroll rather than a wall and three hundred would be too. Budget and
 * size open a slider over the actual distribution of the stock, which is the
 * part brackets could never do: the shape of the case is information, and a
 * row of four brackets flattens it to nothing.
 *
 * Nothing here is a second kind of filter. Every control writes exactly the
 * clause the filter menu writes, so it shows as the same removable chip,
 * lives in the same URL, and saves into the same view.
 */
export function FindBar({ facets, total }: { facets: StockFacetData; total: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [open, setOpen] = useState<string | null>(null)

  const clauses = useMemo(() => parseFilters(params, WATCH_FIELDS), [params])

  const write = useCallback((next: FilterClause[]) => {
    const search = applyFilters(params, next)
    // Back to page one: the list underneath is a different list now, and
    // page four of the old one is a blank screen.
    search.delete('page')
    const query = search.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [params, pathname, router])

  /** The values chosen in one "any of" group. */
  const chosen = (field: string): string[] =>
    clauses.find((clause) => clause.field === field && clause.operator === 'is')?.values ?? []

  /** Toggle one value within its group: within a group they OR, between groups they AND. */
  const toggle = (field: string, value: string) => {
    const current = chosen(field)
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value]
    const rest = clauses.filter((clause) => !(clause.field === field && clause.operator === 'is'))
    write(next.length > 0 ? [...rest, { field, operator: 'is', values: next }] : rest)
  }

  /**
   * Set or clear a range, as the pair of clauses the grammar already has.
   *
   * A handle left at the end of its track is not an opinion — "from the
   * cheapest watch upwards" filters nothing — so that side is written as no
   * clause at all rather than as a bound equal to the limit. Otherwise a
   * chip would appear saying "Retail is more than £1,200" for a slider
   * nobody had moved.
   */
  const setRange = (field: string, lo: number | null, hi: number | null) => {
    const rest = clauses.filter((clause) => !(
      clause.field === field && (clause.operator === 'gt' || clause.operator === 'lt')
    ))
    const next = [...rest]
    if (lo !== null) next.push({ field, operator: 'gt', values: [String(lo)] })
    if (hi !== null) next.push({ field, operator: 'lt', values: [String(hi)] })
    write(next)
  }

  const bound = (field: string, operator: 'gt' | 'lt'): number | null => {
    const value = clauses.find((c) => c.field === field && c.operator === operator)?.values[0]
    return value === undefined ? null : Number(value)
  }

  const clearAll = () => write(clauses.filter((clause) => (
    clause.field !== 'brandId' && clause.field !== 'family' && clause.field !== 'wears'
      && clause.field !== 'estSaleGbp' && clause.field !== 'caseSizeMm'
  )))

  const anyOn = ['brandId', 'family', 'wears'].some((field) => chosen(field).length > 0)
    || bound('estSaleGbp', 'gt') !== null || bound('estSaleGbp', 'lt') !== null
    || bound('caseSizeMm', 'gt') !== null || bound('caseSizeMm', 'lt') !== null

  /**
   * The budget, in the currency this person is reading the business in.
   *
   * The slider itself stays in stored units from end to end — the facet
   * arrives in them and the clause is written in them — because the column
   * being filtered is in stored units and a conversion anywhere along that
   * path would filter on a different number from the one it had counted. Only
   * the labels move, which is the whole of what the switcher means.
   *
   * It said `£` before, over figures that have been dollars since 0018. Not a
   * cosmetic slip: it put the wrong symbol on a number and so misstated every
   * budget on the bar by the exchange rate, in the direction that makes a
   * watch look cheaper than it is.
   */
  const { currency, rates } = useCurrency()
  const money = useCallback((stored: number) => {
    const shown = fromBase(Math.round(stored * 100), currency, rates) / 100
    const symbol = CURRENCY_SYMBOLS[currency]
    // Thousands as "7k" — four digits of precision on a slider handle is
    // precision nobody asked for and it makes the two labels collide.
    return shown >= 1000
      ? `${symbol}${Math.round(shown / 1000).toLocaleString('en-GB')}k`
      : `${symbol}${Math.round(shown).toLocaleString('en-GB')}`
  }, [currency, rates])

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Pick
        id="brand" label="Brand" open={open} setOpen={setOpen}
        summary={summarise(facets.brands, chosen('brandId'), 'brand')}
      >
        <OptionList options={facets.brands} chosen={chosen('brandId')} onToggle={(v) => toggle('brandId', v)} />
      </Pick>

      <Pick
        id="model" label="Model" open={open} setOpen={setOpen}
        summary={summarise(facets.families, chosen('family'), 'model')}
      >
        <OptionList options={facets.families} chosen={chosen('family')} onToggle={(v) => toggle('family', v)} />
      </Pick>

      {facets.price && (
        <Pick
          id="budget" label="Budget" open={open} setOpen={setOpen}
          summary={rangeSummary(bound('estSaleGbp', 'gt'), bound('estSaleGbp', 'lt'), money)}
        >
          <Range
            facet={facets.price}
            lo={bound('estSaleGbp', 'gt')} hi={bound('estSaleGbp', 'lt')}
            onCommit={(lo, hi) => setRange('estSaleGbp', lo, hi)}
            format={money}
          />
        </Pick>
      )}

      {facets.size && (
        <Pick
          id="size" label="Size" open={open} setOpen={setOpen}
          summary={rangeSummary(bound('caseSizeMm', 'gt'), bound('caseSizeMm', 'lt'), (mm) => `${mm}mm`)}
        >
          <Range
            facet={facets.size}
            lo={bound('caseSizeMm', 'gt')} hi={bound('caseSizeMm', 'lt')}
            onCommit={(lo, hi) => setRange('caseSizeMm', lo, hi)}
            format={(mm) => `${mm}mm`}
            step={1}
          />
        </Pick>
      )}

      {facets.wears.length > 1 && (
        <Pick
          id="wears" label="For" open={open} setOpen={setOpen}
          summary={summarise(facets.wears, chosen('wears'), 'choice')}
        >
          <OptionList options={facets.wears} chosen={chosen('wears')} onToggle={(v) => toggle('wears', v)} search={false} />
        </Pick>
      )}

      <span className="ml-auto flex items-center gap-3 text-caption text-content-secondary">
        {anyOn && (
          <button type="button" onClick={clearAll} className="underline underline-offset-2 hover:text-content-primary">
            Clear
          </button>
        )}
        <span className="tabular-nums">
          <b className="font-semibold text-content-primary">{total}</b> {total === 1 ? 'watch' : 'watches'}
        </span>
      </span>
    </div>
  )
}

/** "Rolex", or "2 brands" — the answer, not the question, once there is one. */
function summarise(options: FacetOption[], chosen: string[], noun: string): string | null {
  if (chosen.length === 0) return null
  if (chosen.length === 1) return options.find((option) => option.value === chosen[0])?.label ?? '1'
  return `${chosen.length} ${noun}s`
}

function rangeSummary(lo: number | null, hi: number | null, format: (n: number) => string): string | null {
  if (lo === null && hi === null) return null
  if (lo === null) return `under ${format(hi!)}`
  if (hi === null) return `over ${format(lo)}`
  return `${format(lo)}–${format(hi)}`
}

/**
 * One control: a trigger that reports its own state, and a panel under it.
 *
 * Not portalled, unlike the row menus in the table — this bar sits at the top
 * of the page and is inside nothing that scrolls sideways, so the clipping
 * that forced AnchoredMenu through a portal does not arise, and a plain
 * absolutely-positioned panel is a great deal less to go wrong.
 */
function Pick({ id, label, summary, open, setOpen, children }: {
  id: string
  label: string
  summary: string | null
  open: string | null
  setOpen: (id: string | null) => void
  children: React.ReactNode
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const isOpen = open === id

  useEffect(() => {
    if (!isOpen) return
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null) }
    // Pointerdown, not click: a click that starts inside the panel and ends
    // outside it is a slider drag, and closing on that would make the handles
    // impossible to release anywhere but over the panel.
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [isOpen, setOpen])

  const on = summary !== null

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen(isOpen ? null : id)}
        aria-expanded={isOpen}
        className={cn(
          'inline-flex h-10 items-center gap-2 rounded-pill border px-4 text-caption transition-colors',
          on
            ? 'border-content-primary bg-content-primary text-surface-raised'
            : 'border-line-subtle bg-surface-raised text-content-primary hover:border-line-strong',
        )}
      >
        <span className={cn('font-semibold', on && 'opacity-70')}>{label}</span>
        {on && <span className="font-semibold">{summary}</span>}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} aria-hidden />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[300px] rounded-lg border border-line-subtle bg-surface-raised p-3 shadow-lg">
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * A list you can type into.
 *
 * Thirty-two model families is a scroll; three hundred would be too, and a
 * search box is the difference between those two being the same control and
 * the second one needing a redesign. The chosen ones are pinned to the top so
 * that narrowing the search never hides what you have already picked.
 */
function OptionList({ options, chosen, onToggle, search = true }: {
  options: FacetOption[]
  chosen: string[]
  onToggle: (value: string) => void
  search?: boolean
}) {
  const [term, setTerm] = useState('')
  const needle = term.trim().toLowerCase()
  const shown = useMemo(() => {
    const matching = needle
      ? options.filter((option) => option.label.toLowerCase().includes(needle))
      : options
    const picked = matching.filter((option) => chosen.includes(option.value))
    const rest = matching.filter((option) => !chosen.includes(option.value))
    return [...picked, ...rest]
  }, [options, needle, chosen])

  return (
    <div className="flex flex-col gap-2">
      {search && options.length > 7 && (
        <label className="relative">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" aria-hidden />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search…"
            autoFocus
            className="h-9 w-full rounded-md border border-line-subtle bg-surface-subtle pl-8 pr-2 text-caption text-content-primary placeholder:text-content-muted"
          />
        </label>
      )}
      <div className="-mr-1 max-h-[260px] overflow-y-auto pr-1">
        {shown.length === 0 && (
          <p className="px-1 py-3 text-caption text-content-muted">Nothing matches that.</p>
        )}
        {shown.map((option) => {
          const on = chosen.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(option.value)}
              className="flex w-full items-center gap-2.5 rounded-sm px-1.5 py-1.5 text-left text-caption hover:bg-surface-subtle"
            >
              <span className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border',
                on ? 'border-content-primary bg-content-primary' : 'border-line-strong',
              )}>
                {on && <Check className="h-3 w-3 text-surface-raised" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1 truncate text-content-primary">{option.label}</span>
              <span className="shrink-0 tabular-nums text-content-muted">{option.count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Two handles over the shape of the stock.
 *
 * The bars are the point and are why this replaced brackets. They say where
 * the case actually sits — that most of it is between eight and twenty
 * thousand and there is a tail above fifty — which is a thing a dealer knows
 * and a screen never said out loud. Bars inside the chosen range are drawn
 * solid; the rest recede, so the selection reads as a window onto the stock
 * rather than as two numbers.
 *
 * Dragging updates only local state; the URL is written on release. A write
 * per pixel would refetch the list a hundred times across one drag and the
 * handles would stutter against their own results.
 */
function Range({ facet, lo, hi, onCommit, format, step = 100 }: {
  facet: RangeFacet
  lo: number | null
  hi: number | null
  onCommit: (lo: number | null, hi: number | null) => void
  format: (value: number) => string
  step?: number
}) {
  const { min, max, buckets } = facet
  const track = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<'lo' | 'hi' | null>(null)
  const [local, setLocal] = useState<[number, number]>([lo ?? min, hi ?? max])

  // Follow the URL when it changes under us — a chip removed, the back
  // button — but never while a handle is being held.
  useEffect(() => {
    if (!drag) setLocal([lo ?? min, hi ?? max])
  }, [lo, hi, min, max, drag])

  const [a, b] = local
  const pct = (value: number) => (max === min ? 0 : ((value - min) / (max - min)) * 100)

  const valueAt = (clientX: number): number => {
    const box = track.current?.getBoundingClientRect()
    if (!box || box.width === 0) return min
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    const raw = min + ratio * (max - min)
    return Math.min(max, Math.max(min, Math.round(raw / step) * step))
  }

  useEffect(() => {
    if (!drag) return
    const move = (event: PointerEvent) => {
      const value = valueAt(event.clientX)
      setLocal(([low, high]) => (drag === 'lo'
        ? [Math.min(value, high), high]
        : [low, Math.max(value, low)]))
    }
    const up = () => {
      setDrag(null)
      setLocal(([low, high]) => {
        // A handle still at the end of its track is not an opinion.
        onCommit(low <= min ? null : low, high >= max ? null : high)
        return [low, high]
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, min, max, step])

  const peak = Math.max(1, ...buckets)

  return (
    <div className="flex flex-col gap-2 px-1 pb-1">
      <div className="flex items-baseline justify-between text-caption">
        <span className="font-semibold tabular-nums text-content-primary">{format(a)}</span>
        <span className="font-semibold tabular-nums text-content-primary">
          {format(b)}{b >= max && '+'}
        </span>
      </div>

      {/* The distribution. aria-hidden: it is the same information the
          handles and the labels already carry, drawn for the eye. */}
      <div className="flex h-10 items-end gap-[2px]" aria-hidden>
        {buckets.map((height, index) => {
          const at = min + ((index + 0.5) / buckets.length) * (max - min)
          const inside = at >= a && at <= b
          return (
            <span
              key={index}
              className={cn('flex-1 rounded-t-[1px]', inside ? 'bg-content-primary/55' : 'bg-line-subtle')}
              style={{ height: `${Math.max(8, (height / peak) * 100)}%` }}
            />
          )
        })}
      </div>

      <div ref={track} className="relative mx-[7px] h-[3px] rounded-full bg-line-subtle">
        <span
          className="absolute inset-y-0 rounded-full bg-content-primary"
          style={{ left: `${pct(a)}%`, right: `${100 - pct(b)}%` }}
        />
        {(['lo', 'hi'] as const).map((which) => (
          <button
            key={which}
            type="button"
            aria-label={which === 'lo' ? 'Minimum' : 'Maximum'}
            onPointerDown={(event) => { event.preventDefault(); setDrag(which) }}
            onKeyDown={(event) => {
              const by = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
              if (!by) return
              event.preventDefault()
              const next: [number, number] = which === 'lo'
                ? [Math.min(Math.max(min, a + by), b), b]
                : [a, Math.max(Math.min(max, b + by), a)]
              setLocal(next)
              onCommit(next[0] <= min ? null : next[0], next[1] >= max ? null : next[1])
            }}
            className="absolute top-1/2 h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border border-content-primary bg-surface-raised shadow-sm active:cursor-grabbing"
            style={{ left: `${pct(which === 'lo' ? a : b)}%` }}
          />
        ))}
      </div>

      {(lo !== null || hi !== null) && (
        <button
          type="button"
          onClick={() => { setLocal([min, max]); onCommit(null, null) }}
          className="mt-1 inline-flex items-center gap-1 self-start text-caption text-content-secondary hover:text-content-primary"
        >
          <X className="h-3 w-3" aria-hidden /> Any
        </button>
      )}
    </div>
  )
}
