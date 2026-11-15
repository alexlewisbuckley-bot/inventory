'use client'
import { useMemo, useState } from 'react'
import {
  HISTORY_STATUS_LABELS, historyStatus, spendDate, summariseHistory,
  type HistoryOrder, type HistoryStatus,
} from '@/lib/order-history'
import { percentFromBps } from '@/lib/partner-rate'
import { money } from './filters'

export interface OrderHistoryRow extends HistoryOrder {
  placedAt: string
  completedAt: string | null
  releasedAt: string | null
  brandName: string
  model: string | null
  modelName: string | null
  placedByName: string | null
  campaignName: string | null
  recipientName: string | null
  /** Ours, not theirs: only passed on the staff side. */
  stockNo?: number
}

type Tab = 'ALL' | HistoryStatus

const TABS: Tab[] = ['ALL', 'PURCHASED', 'ON_HOLD', 'RELEASED']

const PILL: Record<HistoryStatus, string> = {
  PURCHASED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  ON_HOLD: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  RELEASED: 'bg-black/[0.04] text-black/50 ring-black/10',
}

const date = (value: Date | string) =>
  new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * What a partner has bought from us, and what it has come to.
 *
 * Totals across the top, a year of spend by month, then every order. One
 * component for both sides of the counter so the partner and our own staff
 * are never looking at two different figures for the same company.
 */
export function OrderHistory({ orders, showStockNo = false }: {
  orders: OrderHistoryRow[]
  showStockNo?: boolean
}) {
  const [tab, setTab] = useState<Tab>('ALL')
  const summary = useMemo(() => summariseHistory(orders), [orders])
  const counts: Record<Tab, number> = {
    ALL: orders.length,
    PURCHASED: summary.purchasedCount,
    ON_HOLD: summary.onHoldCount,
    RELEASED: summary.releasedCount,
  }
  const shown = tab === 'ALL' ? orders : orders.filter((o) => historyStatus(o) === tab)
  const peak = Math.max(...summary.months.map((m) => m.spent), 1)

  if (orders.length === 0) {
    return (
      <p className="rounded-[14px] border border-dashed border-black/15 px-6 py-14 text-center text-[14px] text-black/45">
        No orders yet. Anything reserved from the stock list will appear here.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total spent" value={money(summary.spent)}
          note={`${summary.purchasedCount} ${summary.purchasedCount === 1 ? 'watch' : 'watches'} purchased`} />
        <Stat label="Saved vs asking" value={money(summary.saved)}
          note={summary.spent ? `${((summary.saved / (summary.spent + summary.saved)) * 100).toFixed(1)}% off overall` : '—'} />
        <Stat label="Average order" value={summary.purchasedCount ? money(summary.averageOrder) : '—'}
          note={summary.lastPurchase ? `Last purchase ${date(summary.lastPurchase)}` : 'No purchases yet'} />
        <Stat label="On hold now" value={money(summary.onHold)}
          note={`${summary.onHoldCount} awaiting payment`} />
      </dl>

      {summary.budgetCovered > 0 && (
        <p className="-mt-4 text-[12.5px] text-black/50">
          {money(summary.budgetCovered)} of the total was covered by campaign budgets.
        </p>
      )}

      <section aria-label="Spend by month">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-black/45">
          Spend, last 12 months
        </h3>
        <div className="mt-3 flex h-36 items-end gap-1.5 sm:gap-2.5">
          {summary.months.map((m) => (
            <div key={m.key} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
              <div
                className="w-full rounded-t-[3px] transition-opacity group-hover:opacity-80"
                style={{
                  height: m.spent ? `${Math.max(4, (m.spent / peak) * 100)}%` : '2px',
                  background: m.spent ? 'var(--brand, #111)' : 'rgba(0,0,0,0.08)',
                }}
                title={`${m.label}: ${money(m.spent)} · ${m.count} ${m.count === 1 ? 'order' : 'orders'}`}
              />
              <span className="text-[10.5px] text-black/40">{m.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Orders">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                tab === t ? 'bg-black text-white' : 'bg-black/[0.04] text-black/60 hover:bg-black/[0.08]'
              }`}
            >
              {t === 'ALL' ? 'All' : HISTORY_STATUS_LABELS[t]}
              <span className={`ml-1.5 tabular-nums ${tab === t ? 'text-white/60' : 'text-black/35'}`}>{counts[t]}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto rounded-[14px] border border-black/10">
          <table className="w-full min-w-[640px] text-left text-[13.5px]">
            <thead className="bg-black/[0.02] text-[11px] uppercase tracking-[0.1em] text-black/45">
              <tr>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Watch</th>
                <th className="px-4 py-3 font-semibold">For</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.06]">
              {shown.map((order) => {
                const status = historyStatus(order)
                return (
                  <tr key={order.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-black/60">
                      {date(status === 'PURCHASED' ? spendDate(order) : order.placedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-black">
                        {[order.brandName, order.model].filter(Boolean).join(' ')}
                      </p>
                      <p className="text-[12.5px] text-black/45">
                        {[showStockNo && order.stockNo !== undefined ? `Stock ${order.stockNo}` : null, order.modelName]
                          .filter(Boolean).join(' · ') || ' '}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-black/65">
                      {order.campaignName ? (
                        <>
                          <p>{order.recipientName ?? order.placedByName ?? '—'}</p>
                          <p className="text-[12.5px] text-black/45">{order.campaignName}</p>
                        </>
                      ) : (order.placedByName ?? '—')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium ring-1 ring-inset ${PILL[status]}`}>
                        {HISTORY_STATUS_LABELS[status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <p className={`font-semibold tabular-nums ${status === 'RELEASED' ? 'text-black/40 line-through' : 'text-black'}`}>
                        {money(order.priceAtOrder)}
                      </p>
                      {order.askingAtOrder > order.priceAtOrder && (
                        <p className="text-[12px] tabular-nums text-black/40">
                          {percentFromBps(order.discountBpsAtOrder)} off {money(order.askingAtOrder)}
                        </p>
                      )}
                      {order.budgetApplied ? (
                        <p className="text-[12px] tabular-nums text-black/40">
                          {money(Math.min(order.budgetApplied, order.priceAtOrder))} from budget
                        </p>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-black/40">Nothing here.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-[14px] border border-black/10 px-4 py-4">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-black/45">{label}</dt>
      <dd className="mt-1.5 text-[22px] font-semibold leading-tight tabular-nums text-black">{value}</dd>
      <dd className="mt-1 text-[12px] text-black/45">{note}</dd>
    </div>
  )
}
