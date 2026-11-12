'use client'
import { useId, useMemo, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Check, Search, SlidersHorizontal, X } from 'lucide-react'
import {
  placeOrderAction, placeOrdersAction, leavePortalAction,
  type OrderState, type BulkState,
} from '@/app/actions/partner-portal'
import { percentFromBps } from '@/lib/partner-rate'
import {
  BOX_PAPERS_LABELS, CONDITION_LABELS, type BoxPapers, type Condition,
} from '@/lib/enums'
import type { PortalItem, PortalOrder } from '@/server/services/partner-portal-service'

const INITIAL: OrderState = { ok: false, message: '' }

/** Base minor units to something a person reads, in the house currency. */
function money(base: number): string {
  return `AED ${Math.round(base / 100).toLocaleString('en-GB')}`
}

const describe = (item: PortalItem): string =>
  [item.brandName, item.model, item.modelName].filter(Boolean).join(' ')

/** Everything a row can be searched by, including the words under the picture. */
const searchable = (item: PortalItem): string =>
  [
    item.brandName, item.model, item.modelName, item.dial,
    item.caseMaterial, item.bracelet, item.year,
  ].filter(Boolean).join(' ').toLowerCase()

type Sort = 'brand' | 'priceUp' | 'priceDown' | 'newest'

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'brand', label: 'Brand A–Z' },
  { value: 'priceUp', label: 'Price, lowest first' },
  { value: 'priceDown', label: 'Price, highest first' },
  { value: 'newest', label: 'Newest first' },
]

/** The round numbers a price filter is worth offering, from the stock itself. */
function priceSteps(items: PortalItem[]): number[] {
  if (items.length === 0) return []
  const top = Math.max(...items.map((item) => item.priceGbp))
  // Six or so stops, rounded to something a person would say out loud rather
  // than to the actual maximum, which is always a number like 178,360.
  const rough = top / 6
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rough, 1)))
  const step = Math.ceil(rough / magnitude) * magnitude
  const steps: number[] = []
  for (let value = step; value < top; value += step) steps.push(value)
  return steps
}

/**
 * What a partner sees.
 *
 * A shop, laid out like one: five to a row, every card the same height, and
 * filters across the top. Two hundred watches is past the point where a list
 * is browsable — Alex, looking at it: "add filtering like it is any other
 * website to find watch easily" — so the page has to answer "do you have a
 * steel Daytona around a hundred and fifty thousand" without scrolling.
 *
 * The rate is stated once at the top rather than badged on every row. A page
 * that says "2% off" two hundred times reads as a clearance sale, and this is
 * not a sale; it is what this company always pays.
 *
 * Nothing here is held stock. A reserved piece is gone from this list
 * entirely, whoever reserved it, because a hold says nothing about partner
 * demand — it is just as likely a walk-in with a deposit down — and showing
 * one would be inventing a story about scarcity out of our own shop floor.
 */
export function PortalRoom({ token, partner, items, orders }: {
  token: string
  partner: {
    name: string
    hasLogo: boolean
    brandColor: string
    accentColor: string
    discountBps: number
  }
  items: PortalItem[]
  orders: PortalOrder[]
}) {
  const [query, setQuery] = useState('')
  const [brand, setBrand] = useState('')
  const [boxPapers, setBoxPapers] = useState('')
  const [size, setSize] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [sort, setSort] = useState<Sort>('brand')
  const [more, setMore] = useState(false)
  const [taking, setTaking] = useState<PortalItem | null>(null)
  /* A basket, by watch id. Order does not matter and membership is the only
     question asked of it, so a Set rather than a list. */
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [basketOpen, setBasketOpen] = useState(false)

  /*
   * The choices come from the stock, not from a fixed list.
   *
   * A brand filter offering Patek when there is no Patek in the building is a
   * filter that returns nothing, which reads as the page being broken rather
   * than as us not having one.
   */
  /*
   * Brands with their counts, biggest first.
   *
   * The count is what makes a chip worth tapping — "Rolex 142" says how much
   * of the case it is before anybody filters by it — and ordering by size
   * puts the one most people want under their thumb rather than wherever the
   * alphabet left it.
   */
  const brands = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(item.brandName, (counts.get(item.brandName) ?? 0) + 1)
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [items])
  const sizes = useMemo(
    () => [...new Set(items.map((item) => item.caseSizeMm).filter((n): n is number => n !== null))]
      .sort((a, b) => a - b),
    [items],
  )
  const boxes = useMemo(
    () => [...new Set(items.map((item) => item.boxPapers).filter(
      (value): value is string => Boolean(value) && value !== 'UNKNOWN',
    ))].sort(),
    [items],
  )
  const steps = useMemo(() => priceSteps(items), [items])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const floor = min ? Number(min) : null
    const ceiling = max ? Number(max) : null

    const kept = items.filter((item) => {
      if (needle && !searchable(item).includes(needle)) return false
      if (brand && item.brandName !== brand) return false
      if (boxPapers && item.boxPapers !== boxPapers) return false
      if (size && item.caseSizeMm !== Number(size)) return false
      if (floor !== null && item.priceGbp < floor) return false
      if (ceiling !== null && item.priceGbp > ceiling) return false
      return true
    })

    const sorted = [...kept]
    if (sort === 'priceUp') sorted.sort((a, b) => a.priceGbp - b.priceGbp)
    else if (sort === 'priceDown') sorted.sort((a, b) => b.priceGbp - a.priceGbp)
    else if (sort === 'newest') sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    return sorted
  }, [items, query, brand, boxPapers, size, min, max, sort])

  const clear = () => {
    setQuery(''); setBrand(''); setBoxPapers(''); setSize(''); setMin(''); setMax('')
  }

  /** How many of the filters behind the disclosure are on, for its badge. */
  const narrowed = [size, boxPapers, min, max].filter(Boolean).length

  /*
   * What is applied, as things that can be taken off one at a time.
   *
   * The worst state in a filtered list is an empty one whose cause is
   * off-screen — somebody sets a price ceiling, collapses the panel, searches
   * for a Daytona and concludes we have none.
   */
  const pills: Array<{ label: string; clear: () => void }> = [
    ...(query ? [{ label: `“${query}”`, clear: () => setQuery('') }] : []),
    ...(brand ? [{ label: brand, clear: () => setBrand('') }] : []),
    ...(size ? [{ label: `${size}mm`, clear: () => setSize('') }] : []),
    ...(boxPapers
      ? [{ label: BOX_PAPERS_LABELS[boxPapers as BoxPapers] ?? boxPapers, clear: () => setBoxPapers('') }]
      : []),
    ...(min ? [{ label: `From ${money(Number(min))}`, clear: () => setMin('') }] : []),
    ...(max ? [{ label: `To ${money(Number(max))}`, clear: () => setMax('') }] : []),
  ]

  const basket = items.filter((item) => picked.has(item.id))
  const basketTotal = basket.reduce((sum, item) => sum + item.priceGbp, 0)
  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  /*
   * Held means the ORDER says so and the WATCH agrees.
   *
   * Taking a watch off hold anywhere else used to leave the order saying
   * PLACED for ever, so a partner kept being shown a piece that had gone back
   * on sale. Checking both means a row that drifted stops claiming the watch
   * the moment anybody looks at it.
   */
  const held = orders.filter(
    (order) => order.status === 'PLACED' && order.watchStatus === 'RESERVED',
  )

  return (
    <main
      className="min-h-screen bg-white"
      style={{
        ['--brand' as string]: partner.brandColor,
        ['--accent' as string]: partner.accentColor,
      }}
    >
      <header className="border-b border-black/10 px-5 py-7 sm:px-8">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div>
            {partner.hasLogo ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={`/p/${token}/logo`} alt={partner.name} className="h-9 w-auto object-contain" />
            ) : (
              <p className="font-serif text-[26px] leading-tight" style={{ color: 'var(--brand)' }}>
                {partner.name}
              </p>
            )}
            <p className="mt-1 text-[13px] text-black/55">
              {partner.discountBps > 0
                /*
                 * "Up to", not "every".
                 *
                 * A handful of pieces sit at a floor the rate would have gone
                 * through, so they are discounted by less. Stating the rate as
                 * a flat promise would make the page contradict its own
                 * numbers on those rows, and a partner checking the
                 * arithmetic would find us short rather than careful.
                 */
                ? `Prices below are up to ${percentFromBps(partner.discountBps)} off our asking price.`
                : 'Stock available to you now.'}
            </p>
          </div>
          <div className="flex items-center gap-5">
            {/* Campaigns are the reason most partners are here at all, so the
                way to them is beside the sign-out rather than buried. */}
            <a
              href={`/p/${token}/campaigns`}
              className="text-[12px] uppercase tracking-[0.08em] text-black/50 hover:text-black"
            >
              Campaigns
            </a>
            <form action={leavePortalAction.bind(null, token)}>
              <button type="submit" className="text-[12px] uppercase tracking-[0.08em] text-black/40 hover:text-black/70">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {held.length > 0 && (
        /*
         * What they have reserved, at the top.
         *
         * A partner who reserves a watch watches it disappear from the list
         * below — that is the rule working as intended — and without this the
         * portal would read as having eaten the thing they just asked for.
         */
        <section className="border-b border-black/10 bg-black/[0.02] px-5 py-5 sm:px-8">
          <div className="mx-auto max-w-[1480px]">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-black/50">
              On hold for you
            </p>
            <ul className="mt-2.5 space-y-1.5">
              {held.map((order) => (
                <li key={order.id} className="flex flex-wrap items-baseline gap-x-3 text-[13.5px] text-black/75">
                  <Check className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
                  <span className="font-semibold">
                    {[order.brandName, order.model, order.modelName].filter(Boolean).join(' ')}
                  </span>
                  <span className="tabular-nums">{money(order.priceAtOrder)}</span>
                  <span className="text-black/45">
                    reserved {new Date(order.placedAt).toLocaleDateString('en-GB')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[12px] text-black/45">
              Nothing is paid yet. Somebody from our side will be in touch to settle each one.
            </p>
          </div>
        </section>
      )}

      <div className="mx-auto max-w-[1480px] px-5 py-7 sm:px-8">
        {/*
          * One search, the brands as chips, everything else behind a
          * disclosure.
          *
          * Alex: "Filtering is terrible and not stremalined." It was six
          * selects in a row, each the same weight as the next, so finding a
          * Rolex under twenty thousand meant reading a toolbar before
          * touching it — and on a phone it was a wall before the stock.
          *
          * Brand is what almost every search starts with, so it is one tap
          * and carries its own count; the rest is opened by somebody who
          * actually wants it. What is applied shows as pills that can be
          * taken off one at a time, because the worst state in a filtered
          * list is an empty one whose cause is off-screen.
          */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-[240px] flex-1">
              <span className="sr-only">Search stock</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-black/35" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search model, reference, dial or metal"
                className="h-11 w-full border border-black/15 pl-10 pr-3 text-[14px] text-black outline-none placeholder:text-black/35 focus:border-black/50"
              />
            </label>

            <Choice label="Sort by" value={sort} onChange={(value) => setSort(value as Sort)}
              options={SORTS} />

            <button
              type="button"
              onClick={() => setMore((open) => !open)}
              aria-expanded={more}
              className={`flex h-11 items-center gap-2 border px-4 text-[13px] ${
                narrowed ? 'border-black/50 text-black' : 'border-black/15 text-black/60 hover:border-black/40'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              More filters
              {narrowed > 0 && (
                <span className="flex h-5 min-w-[20px] items-center justify-center bg-black px-1 text-[11px] text-white">
                  {narrowed}
                </span>
              )}
            </button>
          </div>

          {brands.length > 1 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              <Chip on={brand === ''} onClick={() => setBrand('')}>
                All <span className="tabular-nums opacity-60">{items.length}</span>
              </Chip>
              {brands.map(({ name, count }) => (
                <Chip key={name} on={brand === name} onClick={() => setBrand(brand === name ? '' : name)}>
                  {name} <span className="tabular-nums opacity-60">{count}</span>
                </Chip>
              ))}
            </div>
          )}

          {more && (
            <div className="flex flex-wrap items-end gap-3 border border-black/10 p-4">
              <Choice label="Size" value={size} onChange={setSize} any="Any size"
                options={sizes.map((mm) => ({ value: String(mm), label: `${mm}mm` }))} />
              <Choice label="Box & papers" value={boxPapers} onChange={setBoxPapers} any="Any"
                options={boxes.map((value) => ({
                  value, label: BOX_PAPERS_LABELS[value as BoxPapers] ?? value,
                }))} />
              <Choice label="Price from" value={min} onChange={setMin} any="No minimum"
                options={steps.map((value) => ({ value: String(value), label: money(value) }))} />
              <Choice label="Price to" value={max} onChange={setMax} any="No maximum"
                options={steps.map((value) => ({ value: String(value), label: money(value) }))} />
            </div>
          )}

          {pills.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {pills.map((pill) => (
                <button
                  key={pill.label}
                  type="button"
                  onClick={pill.clear}
                  className="flex items-center gap-1.5 border border-black/15 py-1 pl-3 pr-2 text-[12.5px] text-black/70 hover:border-black/40"
                >
                  {pill.label}
                  <X className="h-3 w-3" aria-hidden />
                </button>
              ))}
              <button type="button" onClick={clear} className="px-2 text-[12.5px] text-black/45 hover:text-black">
                Clear all
              </button>
            </div>
          )}
        </div>

        <p className="mt-4 text-[13px] text-black/55">
          {shown.length === items.length
            ? `${items.length} ${items.length === 1 ? 'watch' : 'watches'} available`
            : `${shown.length} of ${items.length} watches`}
        </p>

        {shown.length === 0 ? (
          <p className="py-16 text-center text-[14px] text-black/45">
            {items.length === 0
              ? 'Nothing is available just now. This list changes daily.'
              : 'Nothing matches that. Try widening the price or clearing a filter.'}
          </p>
        ) : (
          /*
           * Five to a row on a desktop, stepping down to two on a phone.
           *
           * Every card is the same height whatever its name runs to: the
           * picture is a fixed square, the name is held to two lines, the
           * details to one, and the button is pushed to the bottom. Without
           * that, one watch called "Royal Oak Offshore Chronograph" drops the
           * button on its card below the four beside it and the row reads as
           * broken.
           */
          <ul className="mt-6 grid grid-cols-2 gap-x-5 gap-y-9 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {shown.map((item) => (
              <li key={item.id} className="group relative flex h-full flex-col">
                {/*
                  * The tick, top-left of the picture.
                  *
                  * Always there once something is selected, and on hover
                  * otherwise: a checkbox on every card all the time turns a
                  * shop into a spreadsheet, and one that only appears on
                  * hover is invisible on a phone.
                  */}
                <button
                  type="button"
                  aria-pressed={picked.has(item.id)}
                  aria-label={`Select ${describe(item)}`}
                  onClick={() => toggle(item.id)}
                  className={`absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center border transition-opacity ${
                    picked.has(item.id)
                      ? 'border-transparent opacity-100'
                      : 'border-black/20 bg-white/90 opacity-0 group-hover:opacity-100 focus:opacity-100'
                  } ${picked.size > 0 ? 'opacity-100' : ''}`}
                  style={picked.has(item.id)
                    ? { backgroundColor: 'var(--brand)', color: '#fff' }
                    : undefined}
                >
                  {picked.has(item.id) && <Check className="h-4 w-4" aria-hidden />}
                </button>

                <div className={`aspect-square w-full overflow-hidden bg-black/[0.02] ${
                  picked.has(item.id) ? 'ring-2 ring-offset-1' : ''
                }`} style={picked.has(item.id) ? { ['--tw-ring-color' as string]: 'var(--brand)' } : undefined}>
                  {item.imageIds[0] && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/p/${token}/image/${item.imageIds[0]}`}
                      alt={describe(item)}
                      loading="lazy"
                      // Contained, not cropped: these are packshots of
                      // different shapes, and cropping them to a square takes
                      // the lugs off a dress watch to make it fill a box.
                      className="h-full w-full object-contain p-3 mix-blend-multiply"
                    />
                  )}
                </div>

                <p className="mt-3 line-clamp-2 min-h-[2.6em] font-serif text-[16px] leading-snug text-black">
                  {describe(item)}
                </p>
                <p className="mt-0.5 line-clamp-1 min-h-[1.3em] text-[12px] text-black/50">
                  {[
                    item.year,
                    item.caseSizeMm ? `${item.caseSizeMm}mm` : null,
                    item.dial,
                    item.condition ? CONDITION_LABELS[item.condition as Condition] : null,
                    item.boxPapers && item.boxPapers !== 'UNKNOWN'
                      ? BOX_PAPERS_LABELS[item.boxPapers as BoxPapers]
                      : null,
                  ].filter(Boolean).join(' · ')}
                </p>

                <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[15px] font-semibold tabular-nums text-black">
                    {money(item.priceGbp)}
                  </span>
                  {item.priceGbp !== item.askingGbp && (
                    <span className="text-[12.5px] tabular-nums text-black/40 line-through">
                      {money(item.askingGbp)}
                    </span>
                  )}
                </p>

                <button
                  type="button"
                  onClick={() => setTaking(item)}
                  className="mt-3 h-10 w-full text-[12px] font-semibold uppercase tracking-[0.08em] text-white"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  Reserve
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        * The basket, pinned to the bottom while anything is selected.
        *
        * Alex: "bulk select and order for somebody trying to purchase
        * multiple watches." A company buying for five directors was placing
        * five orders through five dialogs, typing their name into each — and
        * that is the ordinary case, not an edge one.
        */}
      {picked.size > 0 && (
        <div className="sticky bottom-0 z-20 border-t border-black/10 bg-white/95 px-5 py-3.5 backdrop-blur sm:px-8">
          <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-5 gap-y-2">
            <p className="text-[14px] text-black">
              <span className="font-semibold tabular-nums">{picked.size}</span>
              {picked.size === 1 ? ' watch' : ' watches'} selected
              <span className="ml-3 tabular-nums text-black/60">{money(basketTotal)}</span>
            </p>
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="text-[12.5px] text-black/45 hover:text-black"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setBasketOpen(true)}
              className="ml-auto h-11 px-6 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              Reserve {picked.size === 1 ? 'it' : `all ${picked.size}`}
            </button>
          </div>
        </div>
      )}

      {basketOpen && (
        <BasketDialog
          token={token}
          items={basket}
          total={basketTotal}
          onClose={() => setBasketOpen(false)}
          onDone={() => { setPicked(new Set()); setBasketOpen(false) }}
        />
      )}

      {taking && <ReserveDialog token={token} item={taking} onClose={() => setTaking(null)} />}
    </main>
  )
}

/** A brand, as one tap. The count is what makes it worth tapping. */
function Chip({ on, onClick, children }: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap border px-3.5 py-2 text-[13px] transition-colors ${
        on
          ? 'border-black bg-black text-white'
          : 'border-black/15 text-black/70 hover:border-black/45 hover:text-black'
      }`}
    >
      {children}
    </button>
  )
}

/** One filter. A label above a select, so the row reads without guessing. */
function Choice({ label, value, onChange, options, any }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  /** The "no filter" wording. Omitted where the control always has an answer. */
  any?: string
}) {
  const id = useId()
  if (options.length === 0) return null
  return (
    /*
     * Associated by id rather than by wrapping the select in the label.
     *
     * A wrapped select takes its accessible name from everything inside the
     * label — which, for a select, includes its own options. "Sort by" was
     * being announced as "Sort by Brand A-Z Price lowest first Price highest
     * first", which is the entire menu read out before the control is reached.
     */
    <div className="block">
      <label
        htmlFor={id}
        className="mb-1 block text-[11px] uppercase tracking-[0.06em] text-black/40"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-[128px] border border-black/15 bg-white px-2.5 text-[13.5px] text-black outline-none focus:border-black/50"
      >
        {any && <option value="">{any}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

/**
 * Taking one off the market.
 *
 * It asks for a name and says plainly what happens next, because the thing
 * somebody worries about at this point is whether they have just bought a
 * watch. They have not: the piece goes on hold and a person rings them.
 */
function ReserveDialog({ token, item, onClose }: {
  token: string
  item: PortalItem
  onClose: () => void
}) {
  const [state, action] = useFormState<OrderState, FormData>(
    placeOrderAction.bind(null, token),
    INITIAL,
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`Reserve ${describe(item)}`}
    >
      <div className="w-full max-w-[420px] bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-serif text-[19px] leading-snug text-black">{describe(item)}</p>
            <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-black/80">
              {money(item.priceGbp)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-black/40 hover:text-black">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {state.ok ? (
          <>
            <p className="mt-5 text-[13.5px] leading-relaxed text-black/70">{state.message}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 h-11 w-full text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              Done
            </button>
          </>
        ) : (
          <form action={action} className="mt-5 space-y-3">
            <input type="hidden" name="watchId" value={item.id} />
            <label className="block">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-black/55">Your name</span>
              <input
                name="placedByName"
                required
                className="mt-1 h-11 w-full border border-black/15 px-3 text-[14px] text-black outline-none focus:border-black/50"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-black/55">Email</span>
              <input
                name="placedByEmail"
                type="email"
                className="mt-1 h-11 w-full border border-black/15 px-3 text-[14px] text-black outline-none focus:border-black/50"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-black/55">
                Anything we should know
              </span>
              <textarea
                name="note"
                rows={2}
                className="mt-1 w-full border border-black/15 px-3 py-2 text-[14px] text-black outline-none focus:border-black/50"
              />
            </label>

            <p className="text-[12px] leading-relaxed text-black/50">
              This puts the watch on hold in your name. Nothing is charged, and nothing is
              final until somebody from our side has spoken to you.
            </p>

            {state.message && !state.ok && (
              <p role="alert" className="text-[12.5px] text-[#b42318]">{state.message}</p>
            )}

            <Submit />
          </form>
        )}
      </div>
    </div>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 w-full text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white disabled:opacity-60"
      style={{ backgroundColor: 'var(--brand)' }}
    >
      {pending ? 'Reserving…' : 'Reserve it'}
    </button>
  )
}

/**
 * Reserving a basket.
 *
 * One form for the lot, which is the whole point — the alternative was typing
 * the same name into five dialogs. It lists what is in the basket, because
 * somebody who has been selecting across a filtered list for ten minutes
 * deserves to see it before committing, and a total, because five watches is
 * a number worth reading once.
 */
function BasketDialog({ token, items, total, onClose, onDone }: {
  token: string
  items: PortalItem[]
  total: number
  onClose: () => void
  onDone: () => void
}) {
  const [state, action] = useFormState<BulkState, FormData>(
    placeOrdersAction.bind(null, token),
    { ok: false, message: '' },
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`Reserve ${items.length} watches`}
    >
      <div className="max-h-full w-full max-w-[460px] overflow-y-auto bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            {/*
              * A heading that stops counting once it has happened.
              *
              * The basket is drawn from the stock list, and the moment the
              * reservation lands those pieces leave it — so the header read
              * "Reserve these 0 watches · AED 0" over the message saying
              * three were reserved.
              */}
            {state.ok ? (
              <p className="font-serif text-[20px] leading-snug text-black">
                {state.taken === 1 ? 'Reserved for you' : `${state.taken} reserved for you`}
              </p>
            ) : (
              <>
                <p className="font-serif text-[20px] leading-snug text-black">
                  Reserve {items.length === 1 ? 'this watch' : `these ${items.length} watches`}
                </p>
                <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-black/80">{money(total)}</p>
              </>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-black/40 hover:text-black">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {state.ok ? (
          <>
            <p className="mt-5 text-[13.5px] leading-relaxed text-black/70">{state.message}</p>
            {/*
              * What had gone, said plainly rather than rolled into the total.
              * Four reserved and one missed is a good outcome, and hiding the
              * miss is how somebody turns up expecting five.
              */}
            {state.missed && state.missed.length > 0 && (
              <ul className="mt-3 space-y-1">
                {state.missed.map((reason, index) => (
                  <li key={index} className="text-[12.5px] text-black/50">{reason}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={onDone}
              className="mt-5 h-11 w-full text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              Done
            </button>
          </>
        ) : (
          <form action={action} className="mt-5 space-y-3">
            <input type="hidden" name="watchIds" value={items.map((item) => item.id).join(',')} />

            <ul className="max-h-[180px] space-y-1 overflow-y-auto border-y border-black/10 py-2.5">
              {items.map((item) => (
                <li key={item.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate text-black/75">{describe(item)}</span>
                  <span className="shrink-0 tabular-nums text-black/55">{money(item.priceGbp)}</span>
                </li>
              ))}
            </ul>

            <label className="block">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-black/55">Your name</span>
              <input
                name="placedByName"
                required
                className="mt-1 h-11 w-full border border-black/15 px-3 text-[14px] text-black outline-none focus:border-black/50"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-black/55">Email</span>
              <input
                name="placedByEmail"
                type="email"
                className="mt-1 h-11 w-full border border-black/15 px-3 text-[14px] text-black outline-none focus:border-black/50"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-black/55">
                Anything we should know
              </span>
              <textarea
                name="note"
                rows={2}
                className="mt-1 w-full border border-black/15 px-3 py-2 text-[14px] text-black outline-none focus:border-black/50"
              />
            </label>

            <p className="text-[12px] leading-relaxed text-black/50">
              This puts {items.length === 1 ? 'it' : 'them all'} on hold in your name. Nothing is
              charged, and nothing is final until somebody from our side has spoken to you.
            </p>

            {state.message && !state.ok && (
              <p role="alert" className="text-[12.5px] text-[#b42318]">{state.message}</p>
            )}

            <BasketSubmit count={items.length} />
          </form>
        )}
      </div>
    </div>
  )
}

function BasketSubmit({ count }: { count: number }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 w-full text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white disabled:opacity-60"
      style={{ backgroundColor: 'var(--brand)' }}
    >
      {pending ? 'Reserving…' : `Reserve ${count === 1 ? 'it' : `all ${count}`}`}
    </button>
  )
}
