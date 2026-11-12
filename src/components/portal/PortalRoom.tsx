'use client'
import { useMemo, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Check, Search, X } from 'lucide-react'
import { placeOrderAction, leavePortalAction, type OrderState } from '@/app/actions/partner-portal'
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

/**
 * What a partner sees.
 *
 * One list: the stock we can sell today, each piece with the asking price
 * struck through and their price beside it. The rate is the arrangement, so
 * it is stated once at the top rather than repeated as a badge on every row —
 * a page that says "8.5% off" forty times reads as a sale, and this is not a
 * sale, it is what this company always pays.
 *
 * Nothing here is held stock. A reserved piece is gone from this list
 * entirely, whoever reserved it, because a hold says nothing about partner
 * demand — it is just as likely a walk-in with a deposit down — and showing
 * one would be inventing a story about scarcity out of our own shop floor.
 */
export function PortalRoom({ token, partner, items, orders }: {
  token: string
  partner: { name: string; brandColor: string; accentColor: string; discountBps: number }
  items: PortalItem[]
  orders: PortalOrder[]
}) {
  const [query, setQuery] = useState('')
  const [taking, setTaking] = useState<PortalItem | null>(null)

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) => describe(item).toLowerCase().includes(needle))
  }, [items, query])

  const held = orders.filter((order) => order.status === 'PLACED')

  return (
    <main
      className="min-h-screen bg-white"
      style={{
        ['--brand' as string]: partner.brandColor,
        ['--accent' as string]: partner.accentColor,
      }}
    >
      <header className="border-b border-black/10 px-5 py-7 sm:px-8">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div>
            <p className="font-serif text-[26px] leading-tight" style={{ color: 'var(--brand)' }}>
              {partner.name}
            </p>
            <p className="mt-1 text-[13px] text-black/55">
              {partner.discountBps > 0
                ? `Every price below is ${percentFromBps(partner.discountBps)} off our asking price.`
                : 'Stock available to you now.'}
            </p>
          </div>
          <form action={leavePortalAction.bind(null, token)}>
            <button type="submit" className="text-[12px] uppercase tracking-[0.08em] text-black/40 hover:text-black/70">
              Sign out
            </button>
          </form>
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
          <div className="mx-auto max-w-[1180px]">
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

      <div className="mx-auto max-w-[1180px] px-5 py-7 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-black/55">
            {items.length} {items.length === 1 ? 'watch' : 'watches'} available
          </p>
          <label className="relative">
            <span className="sr-only">Search stock</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-black/35" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-10 w-[220px] border border-black/15 pl-9 pr-3 text-[13.5px] text-black outline-none placeholder:text-black/35 focus:border-black/50"
            />
          </label>
        </div>

        {shown.length === 0 ? (
          <p className="py-16 text-center text-[14px] text-black/45">
            {items.length === 0
              ? 'Nothing is available just now. This list changes daily.'
              : 'Nothing matches that.'}
          </p>
        ) : (
          <ul className="mt-6 grid gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((item) => (
              <li key={item.id}>
                <div className="aspect-square w-full overflow-hidden bg-black/[0.03]">
                  {item.imageIds[0] ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/p/${token}/image/${item.imageIds[0]}`}
                      alt={describe(item)}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[12px] text-black/30">
                      No photograph
                    </div>
                  )}
                </div>

                <p className="mt-3 font-serif text-[17px] leading-snug text-black">
                  {describe(item)}
                </p>
                {/*
                  * Words, not the values we store.
                  *
                  * FULL_SET and BOX_ONLY are our column, and a partner reading
                  * "BOX_ONLY" under a watch is being shown the inside of a
                  * database. "Not recorded" is also dropped rather than
                  * printed: on a page that is selling something, a line
                  * admitting we did not write it down adds nothing a blank
                  * does not already say.
                  */}
                <p className="mt-0.5 text-[12.5px] text-black/50">
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

                <p className="mt-2 flex items-baseline gap-2">
                  <span className="text-[16px] font-semibold tabular-nums text-black">
                    {money(item.priceGbp)}
                  </span>
                  {item.priceGbp !== item.askingGbp && (
                    <span className="text-[13px] tabular-nums text-black/40 line-through">
                      {money(item.askingGbp)}
                    </span>
                  )}
                </p>

                <button
                  type="button"
                  onClick={() => setTaking(item)}
                  className="mt-3 h-10 w-full text-[12.5px] font-semibold uppercase tracking-[0.08em] text-white"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  Reserve
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

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
