'use client'
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { Lightbox } from '@/components/ui/Lightbox'
import { leaveTradeRoomAction } from '@/app/actions/trade-room'
import {
  BOX_PAPERS_LABELS, CONDITION_LABELS,
  type BoxPapers, type Condition,
} from '@/lib/enums'

export interface TradeItem {
  id: string
  brandName: string
  model: string
  nickname: string | null
  year: number | null
  condition: string
  boxPapers: string
  caseSizeMm: number | null
  caseMaterial: string | null
  dial: string | null
  bracelet: string | null
  imageIds: string[]
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
 * So: no prices anywhere — not hidden, never sent — and the picture is the
 * trade shot, which is the watch as it actually is. The filters are the
 * questions a dealer asks: whose, which model, what size, how old, what
 * condition, and is the set complete.
 *
 * Everything is filtered in the browser. The whole room is a few hundred rows
 * of text and a list of image ids, which is smaller than one of the
 * photographs it describes; paging it off the server would cost a round trip
 * per keystroke to save nothing.
 */
export function TradeRoom({ token, reseller, publicToken, items }: {
  token: string
  reseller: { name: string; brandColor: string; accentColor: string; hasLogo: boolean }
  publicToken: string
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
        if (!chosen.includes(valueOf(item, group))) return false
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
        if (!chosen.includes(valueOf(item, other))) return false
      }
      return true
    })
    const tally = new Map<string, number>()
    for (const item of under) {
      const value = valueOf(item, group.key)
      if (!value) continue
      tally.set(value, (tally.get(value) ?? 0) + 1)
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
              src={`/t/${token}/logo?v=${publicToken.slice(0, 6)}`}
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
            className="h-11 w-full border border-black/15 pl-10 pr-3 text-[14px] text-black outline-none placeholder:text-black/35 focus:border-black/50"
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
                      src={`/t/${token}/image/${item.imageIds[0]}`}
                      alt={`${item.brandName} ${item.model}`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </span>
                  <span className="mt-2.5 block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-black/45">
                    {item.brandName}
                    {item.imageIds.length > 1 && (
                      <span className="float-right font-normal tabular-nums normal-case tracking-normal">
                        {item.imageIds.length} photos
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block font-serif text-[17px] leading-tight text-black">
                    {item.nickname || item.model}
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
              </li>
            ))}
          </ul>
        )}
      </div>

      {viewing && (
        <Lightbox
          images={viewing.item.imageIds.map((id) => ({
            src: `/t/${token}/image/${id}`,
            alt: `${viewing.item.brandName} ${viewing.item.model}`,
            caption: `${viewing.item.brandName} ${viewing.item.nickname || viewing.item.model} · ${viewing.item.model}`,
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
 * The model family, read off the nickname.
 *
 * Same cut as the stock list makes: everything up to a quoted nickname, a
 * dash or a trailing case size. "Submariner Date "Hulk" Green 40" is a
 * Submariner Date, and a dealer asking for Submariners means all of them.
 */
function familyOf(item: TradeItem): string {
  const source = item.nickname ?? ''
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

function valueOf(item: TradeItem, group: string): string {
  switch (group) {
    case 'brand': return item.brandName
    case 'family': return familyOf(item)
    case 'size': return sizeBand(item.caseSizeMm)
    case 'year': return item.year ? String(item.year) : ''
    case 'condition': return item.condition === 'UNKNOWN' ? '' : item.condition
    case 'set': return item.boxPapers === 'UNKNOWN' ? '' : item.boxPapers
    default: return ''
  }
}

const searchable = (item: TradeItem): string => [
  item.brandName, item.model, item.nickname, item.caseMaterial, item.dial, item.bracelet,
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
        className={`inline-flex h-9 items-center gap-2 border px-3.5 text-[12.5px] transition-colors ${
          chosen
            ? 'border-black bg-black text-white'
            : 'border-black/15 text-black/80 hover:border-black/45'
        }`}
      >
        <span className={chosen ? 'opacity-60' : 'font-medium'}>{label}</span>
        {chosen && <span className="font-semibold">{summary}</span>}
        <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
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
          <div className="absolute left-0 top-[calc(100%+5px)] z-30 w-[260px] border border-black/15 bg-white p-2 shadow-[0_12px_32px_rgba(0,0,0,0.12)]">
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
  return (
    <div className="max-h-[280px] overflow-y-auto">
      {options.map((option) => {
        const on = chosen.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onToggle(option.value)}
            className="flex w-full items-center gap-2.5 px-1.5 py-1.5 text-left text-[12.5px] hover:bg-black/[0.04]"
          >
            <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${
              on ? 'border-black bg-black' : 'border-black/30'
            }`}>
              {on && <X className="h-2.5 w-2.5 rotate-45 text-white" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1 truncate text-black/85">{option.label}</span>
            <span className="shrink-0 tabular-nums text-black/40">{option.count}</span>
          </button>
        )
      })}
    </div>
  )
}
