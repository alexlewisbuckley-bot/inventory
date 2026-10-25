'use client'
import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { Lightbox } from '@/components/ui/Lightbox'
import { leaveTradeRoomAction } from '@/app/actions/trade-room'
import {
  BOX_PAPERS_LABELS, CONDITION_LABELS, MENS_MIN_MM, WEARS_LABELS, WOMENS_MAX_MM,
  type BoxPapers, type Condition, type Wears,
} from '@/lib/enums'

export interface TradeItem {
  id: string
  brandName: string
  model: string
  modelName: string | null
  year: number | null
  condition: string
  boxPapers: string
  caseSizeMm: number | null
  caseMaterial: string | null
  dial: string | null
  bracelet: string | null
  /** The website photographs — the ones that show the watch properly. */
  imageIds: string[]
  /** The trade shots: the watch as it actually is, offered behind a tap. */
  tradeImageIds: string[]
}

/**
 * The photographs for one watch, in the order a dealer should meet them.
 *
 * The website shots first, because they show the piece; the trade shots
 * after, because they show its condition. Both in one strip so the viewer
 * is a single run of arrow presses rather than two separate galleries with
 * a mode switch between them.
 *
 * A watch with no website photograph falls back to its trade shots rather
 * than showing an empty frame — the list requires a picture of some kind,
 * not a particular kind, and the two are not the same promise.
 */
function gallery(item: TradeItem): Array<{ id: string; trade: boolean }> {
  const site = item.imageIds.map((id) => ({ id, trade: false }))
  const trade = item.tradeImageIds.map((id) => ({ id, trade: true }))
  return site.length > 0 ? [...site, ...trade] : trade
}

/** Where the trade shots begin, so one tap can land on them. */
function tradeAt(item: TradeItem): number {
  return item.imageIds.length > 0 ? item.imageIds.length : 0
}

/**
 * The trade room.
 *
 * A dealer list, which is a different object from a shop. A shop sells one
 * watch at a time: a photograph that flatters, a price, a button. A dealer is
 * reading down a list deciding which three to ask about, and what they need
 * is the real photograph, the reference, and a fast way to cut two hundred
 * pieces down to the ones they deal in.
 *
 * So: no prices anywhere — not hidden, never sent. The picture is the
 * website photograph, which is the one that shows the watch; the trade
 * shot is one tap behind it, because a dealer wants to see the piece as it
 * actually is before they ring, not instead of seeing it at all. The
 * filters are the questions a dealer asks: whose, which model, what size, how old, what
 * condition, and is the set complete.
 *
 * Everything is filtered in the browser. The whole room is a few hundred rows
 * of text and a list of image ids, which is smaller than one of the
 * photographs it describes; paging it off the server would cost a round trip
 * per keystroke to save nothing.
 */
export function TradeRoom({ token, reseller, items }: {
  token: string
  reseller: { name: string; brandColor: string; accentColor: string; hasLogo: boolean }
  items: TradeItem[]
}) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [viewing, setViewing] = useState<{ item: TradeItem; at: number } | null>(null)

  const toggle = (group: string, value: string) => setPicked((current) => {
    const chosen = current[group] ?? []
    const next = chosen.includes(value)
      ? chosen.filter((entry) => entry !== value)
      : [...chosen, value]
    return { ...current, [group]: next }
  })

  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase()
    return items.filter((item) => {
      if (needle && !searchable(item).includes(needle)) return false
      for (const [group, chosen] of Object.entries(picked)) {
        if (chosen.length === 0) continue
        if (!holds(item, group, chosen)) return false
      }
      return true
    })
  }, [items, term, picked])

  /**
   * Each group counted under every other group's choices, never its own.
   *
   * The whole of why these are facets and not a fixed list: choosing Rolex
   * narrows the models while the brand list still offers Patek, because
   * changing your mind is the next thing anybody does.
   */
  const facets = useMemo(() => GROUPS.map((group) => {
    const needle = term.trim().toLowerCase()
    const under = items.filter((item) => {
      if (needle && !searchable(item).includes(needle)) return false
      for (const [other, chosen] of Object.entries(picked)) {
        if (other === group.key || chosen.length === 0) continue
        if (!holds(item, other, chosen)) return false
      }
      return true
    })
    const tally = new Map<string, number>()
    for (const item of under) {
      for (const value of valuesOf(item, group.key)) {
        tally.set(value, (tally.get(value) ?? 0) + 1)
      }
    }
    return {
      ...group,
      options: [...tally.entries()]
        .map(([value, count]) => ({ value, label: group.label_(value), count }))
        .sort((a, b) => group.order(a, b)),
    }
  }), [items, term, picked])

  const on = Object.values(picked).some((chosen) => chosen.length > 0) || term.length > 0

  return (
    <main
      className="min-h-screen bg-white px-5 pb-20 pt-8 sm:px-8"
      style={{
        ['--brand' as string]: reseller.brandColor,
        ['--accent' as string]: reseller.accentColor,
      }}
    >
      <header className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 border-b border-black/10 pb-5">
        <div className="flex min-w-0 items-center gap-3">
          {reseller.hasLogo ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`/t/${token}/logo`}
              alt={reseller.name}
              className="h-8 w-auto shrink-0 object-contain"
            />
          ) : (
            <span className="truncate font-serif text-[20px]" style={{ color: 'var(--brand)' }}>
              {reseller.name}
            </span>
          )}
          <span className="shrink-0 border border-black/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-black/55">
            Trade
          </span>
        </div>

        <form action={leaveTradeRoomAction.bind(null, token)}>
          <button type="submit" className="text-[12px] text-black/45 underline underline-offset-2 hover:text-black/80">
            Sign out
          </button>
        </form>
      </header>

      <div className="mx-auto mt-5 max-w-[1180px]">
        <label className="relative block">
          <span className="sr-only">Search the trade list</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-black/35" aria-hidden />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Reference, model or brand…"
            className="h-11 w-full rounded-full border border-black/12 bg-black/[0.02] pl-10 pr-3 text-[14px] text-black outline-none placeholder:text-black/35 focus:border-black/40 focus:bg-white"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {facets.map((group) => (
            group.options.length > 1 && (
              <Pick
                key={group.key}
                id={group.key}
                label={group.label}
                summary={summarise(group.options, picked[group.key] ?? [], group.noun)}
                open={open}
                setOpen={setOpen}
              >
                <OptionList
                  options={group.options}
                  chosen={picked[group.key] ?? []}
                  onToggle={(value) => toggle(group.key, value)}
                />
              </Pick>
            )
          ))}

          <span className="ml-auto flex items-center gap-3 text-[12.5px] text-black/50">
            {on && (
              <button
                type="button"
                onClick={() => { setPicked({}); setTerm('') }}
                className="underline underline-offset-2 hover:text-black/80"
              >
                Clear
              </button>
            )}
            <span className="tabular-nums">
              <b className="font-semibold text-black/80">{matches.length}</b>
              {matches.length === 1 ? ' watch' : ' watches'}
            </span>
          </span>
        </div>

        {matches.length === 0 ? (
          <p className="mt-16 text-center text-[14px] text-black/45">
            Nothing in the list matches that.
          </p>
        ) : (
          <ul className="mt-6 grid grid-cols-2 gap-x-5 gap-y-9 md:grid-cols-3 lg:grid-cols-4">
            {matches.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setViewing({ item, at: 0 })}
                  className="group block w-full text-left"
                >
                  <span className="block aspect-square w-full overflow-hidden bg-[#f4f3f1]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/t/${token}/image/${gallery(item)[0].id}`}
                      alt={`${item.brandName} ${item.model}`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </span>
                  <span className="mt-2.5 block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-black/45">
                    {item.brandName}
                    {gallery(item).length > 1 && (
                      <span className="float-right font-normal tabular-nums normal-case tracking-normal">
                        {gallery(item).length} photos
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block font-serif text-[17px] leading-tight text-black">
                    {item.modelName || item.model}
                  </span>
                  {/* The reference, always, and on its own line. It is what a
                      dealer writes down and what they will quote back. */}
                  <span className="mt-0.5 block text-[12px] tabular-nums text-black/55">
                    {item.model}
                  </span>
                  <span className="mt-1.5 block text-[12px] text-black/50">
                    {describe(item)}
                  </span>
                </button>
                {/* Only where there is one, and only where it is not already
                    what is on the card. Offering "view trade image" on a
                    watch whose only picture is the trade image is a button
                    that appears to do nothing. */}
                {item.tradeImageIds.length > 0 && item.imageIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setViewing({ item, at: tradeAt(item) })}
                    className="mt-1.5 text-[11px] uppercase tracking-[0.08em] text-black/45 underline underline-offset-[3px] transition-colors hover:text-black"
                  >
                    View trade image
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {viewing && (
        <Lightbox
          images={gallery(viewing.item).map(({ id, trade }) => ({
            src: `/t/${token}/image/${id}`,
            alt: `${viewing.item.brandName} ${viewing.item.model}`,
            // The trade shots say so. Unlabelled, a dealer cannot tell
            // whether a mark is on the watch or on the photograph.
            caption: `${viewing.item.brandName} ${viewing.item.modelName || viewing.item.model} · ${viewing.item.model}${trade ? ' · Trade photo' : ''}`,
          }))}
          index={viewing.at}
          onIndex={(at) => setViewing((current) => (current ? { ...current, at } : null))}
          onClose={() => setViewing(null)}
        />
      )}
    </main>
  )
}

// ---------------------------------------------------------------------------
// What can be asked of the list
// ---------------------------------------------------------------------------

/**
 * The six questions a dealer asks, and not one about money.
 *
 * Size is banded rather than exact because a dealer asks for "thirty-sixes",
 * meaning 36 and 37 and probably 35, and a list of every millimetre in the
 * case turns one question into eleven options.
 */
const GROUPS = [
  {
    key: 'brand', label: 'Brand', noun: 'brands',
    label_: (value: string) => value,
    order: (a: { count: number; label: string }, b: { count: number; label: string }) =>
      b.count - a.count || a.label.localeCompare(b.label),
  },
  {
    key: 'family', label: 'Model', noun: 'models',
    label_: (value: string) => value,
    order: (a: { count: number; label: string }, b: { count: number; label: string }) =>
      b.count - a.count || a.label.localeCompare(b.label),
  },
  {
    key: 'dial', label: 'Dial', noun: 'colours',
    label_: (value: string) => value,
    order: (a: { count: number; label: string }, b: { count: number; label: string }) =>
      b.count - a.count || a.label.localeCompare(b.label),
  },
  {
    key: 'wears', label: 'Worn by', noun: 'choices',
    label_: (value: string) => WEARS_LABELS[value as Wears] ?? value,
    // Men's first, because it is the larger half of almost every case.
    order: (a: { value: string }, b: { value: string }) => (a.value === 'MENS' ? -1 : b.value === 'MENS' ? 1 : 0),
  },
  {
    key: 'size', label: 'Size', noun: 'sizes',
    label_: (value: string) => value,
    order: (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label),
  },
  {
    key: 'year', label: 'Year', noun: 'years',
    label_: (value: string) => value,
    order: (a: { label: string }, b: { label: string }) => b.label.localeCompare(a.label),
  },
  {
    key: 'condition', label: 'Condition', noun: 'grades',
    label_: (value: string) => CONDITION_LABELS[value as Condition] ?? value,
    order: (a: { count: number }, b: { count: number }) => b.count - a.count,
  },
  {
    key: 'set', label: 'Box & papers', noun: 'options',
    label_: (value: string) => BOX_PAPERS_LABELS[value as BoxPapers] ?? value,
    order: (a: { count: number }, b: { count: number }) => b.count - a.count,
  },
] as const

/**
 * The model family, read off the model name.
 *
 * Same cut as the stock list makes: everything up to a quoted model name, a
 * dash or a trailing case size. "Submariner Date "Hulk" Green 40" is a
 * Submariner Date, and a dealer asking for Submariners means all of them.
 */
function familyOf(item: TradeItem): string {
  const source = item.modelName ?? ''
  const cut = source
    .replace(/\s*[“”"–—].*$/, '')
    .replace(/\s+(2\d|[3-5]\d|60)(\s*mm)?$/i, '')
    .trim()
  return cut || item.model
}

/** Bands wide enough to be a question somebody actually asks. */
function sizeBand(mm: number | null): string {
  if (mm === null) return ''
  if (mm < 34) return 'Under 34mm'
  if (mm <= 37) return '34–37mm'
  if (mm <= 40) return '38–40mm'
  if (mm <= 43) return '41–43mm'
  return '44mm and over'
}

/**
 * Every answer a watch gives to one question — usually one, sometimes two.
 *
 * Who a watch is for is the exception, and it is deliberate: 35 to 37mm is
 * worn by anyone, and forcing a 36mm Datejust into one list means never
 * showing it to half the people it suits. The same bands the stock list uses,
 * so a dealer and the shop agree about what a midsize is.
 */
function valuesOf(item: TradeItem, group: string): string[] {
  if (group !== 'wears') {
    const value = valueOf(item, group)
    return value ? [value] : []
  }
  const mm = item.caseSizeMm
  if (mm === null) return []
  const wears: string[] = []
  if (mm >= MENS_MIN_MM) wears.push('MENS')
  if (mm <= WOMENS_MAX_MM) wears.push('WOMENS')
  return wears
}

/** Whether a watch answers one of the values chosen in a group. */
function holds(item: TradeItem, group: string, chosen: string[]): boolean {
  return valuesOf(item, group).some((value) => chosen.includes(value))
}

function valueOf(item: TradeItem, group: string): string {
  switch (group) {
    case 'brand': return item.brandName
    case 'family': return familyOf(item)
    case 'dial': return item.dial ?? ''
    case 'size': return sizeBand(item.caseSizeMm)
    case 'year': return item.year ? String(item.year) : ''
    case 'condition': return item.condition === 'UNKNOWN' ? '' : item.condition
    case 'set': return item.boxPapers === 'UNKNOWN' ? '' : item.boxPapers
    default: return ''
  }
}

const searchable = (item: TradeItem): string => [
  item.brandName, item.model, item.modelName, item.caseMaterial, item.dial, item.bracelet,
  item.year ? String(item.year) : null,
].filter(Boolean).join(' ').toLowerCase()

/** The line under a card: what it is, in the order somebody would say it. */
function describe(item: TradeItem): string {
  return [
    item.year ? String(item.year) : null,
    item.caseSizeMm ? `${item.caseSizeMm}mm` : null,
    item.caseMaterial,
    item.dial ? `${item.dial} dial` : null,
    item.boxPapers === 'UNKNOWN' ? null : BOX_PAPERS_LABELS[item.boxPapers as BoxPapers],
  ].filter(Boolean).join(' · ')
}

function summarise(
  options: Array<{ value: string; label: string }>,
  chosen: string[],
  noun: string,
): string | null {
  if (chosen.length === 0) return null
  if (chosen.length === 1) return options.find((o) => o.value === chosen[0])?.label ?? '1'
  return `${chosen.length} ${noun}`
}

function Pick({ id, label, summary, open, setOpen, children }: {
  id: string
  label: string
  summary: string | null
  open: string | null
  setOpen: (id: string | null) => void
  children: React.ReactNode
}) {
  const isOpen = open === id
  const chosen = summary !== null

  // Escape shuts it. Without this the invisible sheet below stays over the
  // page after the one gesture everybody tries first, and the list underneath
  // silently stops taking clicks — which reads as the page having died.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, setOpen])
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(isOpen ? null : id)}
        aria-expanded={isOpen}
        className={`inline-flex h-9 max-w-[260px] items-center gap-2 rounded-full border px-4 text-[12.5px] transition-colors ${
          chosen
            ? 'border-black bg-black text-white'
            : 'border-black/12 bg-black/[0.02] text-black/75 hover:border-black/35 hover:bg-black/[0.05]'
        }`}
      >
        <span className={chosen ? 'shrink-0 opacity-55' : 'font-medium'}>{label}</span>
        {chosen && <span className="truncate font-semibold">{summary}</span>}
        <ChevronDown className={`h-3 w-3 shrink-0 opacity-70 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {isOpen && (
        <>
          {/* A click anywhere else shuts it. A transparent sheet rather than a
              document listener: there is no drag to protect here, and one
              element is less to get wrong than a pair of effects. */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(null)}
            className="fixed inset-0 z-20 cursor-default"
          />
          <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[268px] rounded-lg border border-black/10 bg-white p-2 shadow-[0_16px_40px_rgba(0,0,0,0.14)]">
            {children}
          </div>
        </>
      )}
    </div>
  )
}

function OptionList({ options, chosen, onToggle }: {
  options: Array<{ value: string; label: string; count: number }>
  chosen: string[]
  onToggle: (value: string) => void
}) {
  const [term, setTerm] = useState('')
  const needle = term.trim().toLowerCase()
  // Chosen pinned to the top, so narrowing the search never hides what you
  // have already picked and then looks as though it was forgotten.
  const shown = useMemo(() => {
    const matching = needle
      ? options.filter((option) => option.label.toLowerCase().includes(needle))
      : options
    return [
      ...matching.filter((option) => chosen.includes(option.value)),
      ...matching.filter((option) => !chosen.includes(option.value)),
    ]
  }, [options, needle, chosen])

  return (
    <div className="flex flex-col gap-1.5">
      {options.length > 8 && (
        <label className="relative">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-black/30" aria-hidden />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search…"
            autoFocus
            className="h-8 w-full rounded-[4px] border border-black/12 bg-black/[0.02] pl-8 pr-2 text-[12.5px] text-black outline-none placeholder:text-black/35 focus:border-black/40"
          />
        </label>
      )}
      <div className="-mr-1 max-h-[260px] overflow-y-auto pr-1">
        {shown.length === 0 && (
          <p className="px-2 py-3 text-[12.5px] text-black/40">Nothing matches that.</p>
        )}
        {shown.map((option) => {
        const on = chosen.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onToggle(option.value)}
            className="group/opt flex w-full items-center gap-2.5 rounded-[4px] px-2 py-[7px] text-left text-[12.5px] transition-colors hover:bg-black/[0.045]"
          >
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
              on ? 'border-black bg-black' : 'border-black/25 group-hover/opt:border-black/50'
            }`}>
              {on && <Check className="h-3 w-3 text-white" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1 truncate text-black/85">{option.label}</span>
            <span className="shrink-0 tabular-nums text-black/35">{option.count}</span>
          </button>
          )
        })}
      </div>
    </div>
  )
}
