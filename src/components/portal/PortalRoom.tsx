'use client'
import { useMemo, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Check, X } from 'lucide-react'
import {
  placeOrderAction, placeOrdersAction, leavePortalAction,
  type OrderState, type BulkState,
} from '@/app/actions/partner-portal'
import { percentFromBps } from '@/lib/partner-rate'
import {
  BOX_PAPERS_LABELS, CONDITION_LABELS, type BoxPapers, type Condition,
} from '@/lib/enums'
import { FilterBar, FilterRail, SortSelect } from './FilterRail'
import { WatchCard, WatchGrid } from './WatchCard'
import { applyFilters, money, priceBands, sizeBands, NO_FILTERS, type FilterState } from './filters'
import type { PortalItem, PortalOrder } from '@/server/services/partner-portal-service'

const INITIAL: OrderState = { ok: false, message: '' }

const describe = (item: PortalItem): string =>
  [item.brandName, item.model, item.modelName].filter(Boolean).join(' ')

/** The line under the name, in the plainest words a dealer would use. */
const details = (item: PortalItem): string =>
  [
    item.year,
    item.caseSizeMm ? `${item.caseSizeMm}mm` : null,
    item.dial,
    item.condition ? CONDITION_LABELS[item.condition as Condition] : null,
    item.boxPapers && item.boxPapers !== 'UNKNOWN'
      ? BOX_PAPERS_LABELS[item.boxPapers as BoxPapers]
      : null,
  ].filter(Boolean).join(' · ')

type Sort = 'brand' | 'priceUp' | 'priceDown' | 'newest'

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'brand', label: 'Brand A–Z' },
  { value: 'priceUp', label: 'Price, lowest first' },
  { value: 'priceDown', label: 'Price, highest first' },
  { value: 'newest', label: 'Newest first' },
]

/**
 * What a partner sees.
 *
 * A shop, laid out like one: filters down the left, stock beside them, five
 * to a row where the screen has room for five and every card the same height.
 * Two hundred watches is past the point where a list is browsable — Alex:
 * "add filtering like it is any other website to find watch easily" — so the
 * page has to answer "do you have a steel Daytona around a hundred and fifty
 * thousand" without scrolling.
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
  /*
   * Every filter in one object.
   *
   * It was five useState calls and a hand-written predicate, which is how the
   * two pages ended up filtering differently — and how the campaign page
   * ended up not filtering at all. One shape, one set of rules, both pages.
   */
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS)
  const [sort, setSort] = useState<Sort>('brand')
  const [taking, setTaking] = useState<PortalItem | null>(null)
  /* A basket, by watch id. Order does not matter and membership is the only
     question asked of it, so a Set rather than a list. */
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [basketOpen, setBasketOpen] = useState(false)

  const shown = useMemo(() => {
    const bands = { price: priceBands(items), size: sizeBands(items) }
    const kept = applyFilters(items, filters, bands)
    const sorted = [...kept]
    if (sort === 'priceUp') sorted.sort((a, b) => a.priceGbp - b.priceGbp)
    else if (sort === 'priceDown') sorted.sort((a, b) => b.priceGbp - a.priceGbp)
    else if (sort === 'newest') sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    return sorted
  }, [items, filters, sort])

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
      <header className="border-b border-black/10 px-5 py-6 sm:px-8">
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

      <FilterBar
        items={items}
        state={filters}
        onChange={setFilters}
        resultCount={shown.length}
        total={items.length}
      >
        <SortSelect value={sort} options={SORTS} onChange={setSort} />
      </FilterBar>

      {/*
        * Rail left, stock right.
        *
        * Alex, on the panel this replaces: "do you really think this is world
        * class e-commercing filtering for a watch company?" It is not what a
        * watch shop does — a shop puts the filters down the side where they
        * stay put, so changing your mind is one tap from wherever you have
        * scrolled to rather than a hunt back up the page for a button.
        */}
      <div className="mx-auto flex max-w-[1480px] gap-8 px-5 py-6 sm:px-8">
        <FilterRail items={items} state={filters} onChange={setFilters} />

        <div className="min-w-0 flex-1">
          {shown.length === 0 ? (
            <p className="py-20 text-center text-[14px] text-black/45">
              {items.length === 0
                ? 'Nothing is available just now. This list changes daily.'
                : 'Nothing matches that. Try a wider price band, or clear a filter.'}
            </p>
          ) : (
            <WatchGrid>
              {shown.map((item) => (
                <WatchCard
                  key={item.id}
                  title={describe(item)}
                  details={details(item)}
                  imageSrc={item.imageIds[0] ? `/p/${token}/image/${item.imageIds[0]}` : null}
                  selected={picked.has(item.id)}
                  onSelect={() => toggle(item.id)}
                >
                  <p className="flex flex-wrap items-baseline gap-x-2">
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
                </WatchCard>
              ))}
            </WatchGrid>
          )}
        </div>
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
