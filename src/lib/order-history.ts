/**
 * A partner's purchase and spend history, worked out from their orders.
 *
 * Pure, so the portal and the staff partner page add up the same way and a
 * test can hold the arithmetic still. Every amount is in base minor units,
 * the same as the order rows themselves.
 */

/** What an order amounts to now, after checking the watch agrees. */
export type HistoryStatus = 'PURCHASED' | 'ON_HOLD' | 'RELEASED'

export const HISTORY_STATUS_LABELS: Record<HistoryStatus, string> = {
  PURCHASED: 'Purchased',
  ON_HOLD: 'On hold',
  RELEASED: 'Released',
}

export interface HistoryOrder {
  id: string
  status: string
  watchStatus: string
  placedAt: Date | string
  completedAt: Date | string | null
  releasedAt: Date | string | null
  priceAtOrder: number
  askingAtOrder: number
  discountBpsAtOrder: number
  budgetApplied: number | null
}

/**
 * Held only while the order AND the watch both say so.
 *
 * The same rule as the stock page: an order left at PLACED after its watch
 * moved on is not a hold, and counting it as one would put money in "on hold"
 * that nobody is going to be asked for.
 */
export function historyStatus(order: Pick<HistoryOrder, 'status' | 'watchStatus'>): HistoryStatus {
  if (order.status === 'COMPLETED') return 'PURCHASED'
  if (order.status === 'PLACED' && order.watchStatus === 'RESERVED') return 'ON_HOLD'
  return 'RELEASED'
}

/** When the money was committed: invoiced if it was, otherwise ordered. */
export function spendDate(order: Pick<HistoryOrder, 'completedAt' | 'placedAt'>): Date {
  return new Date(order.completedAt ?? order.placedAt)
}

export interface MonthSpend {
  /** YYYY-MM */
  key: string
  label: string
  spent: number
  count: number
}

export interface HistorySummary {
  purchasedCount: number
  spent: number
  /** Asking price less what they paid, across what they bought. */
  saved: number
  /** What employers' campaign budgets covered of the amount spent. */
  budgetCovered: number
  averageOrder: number
  onHoldCount: number
  onHold: number
  releasedCount: number
  firstPurchase: Date | null
  lastPurchase: Date | null
  /** The last twelve calendar months, oldest first, including empty ones. */
  months: MonthSpend[]
}

const monthKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

export function summariseHistory(orders: HistoryOrder[], now: Date = new Date()): HistorySummary {
  const months: MonthSpend[] = []
  for (let back = 11; back >= 0; back--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    months.push({
      key: monthKey(d),
      label: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }),
      spent: 0,
      count: 0,
    })
  }
  const byKey = new Map(months.map((m) => [m.key, m]))

  const summary: HistorySummary = {
    purchasedCount: 0, spent: 0, saved: 0, budgetCovered: 0, averageOrder: 0,
    onHoldCount: 0, onHold: 0, releasedCount: 0,
    firstPurchase: null, lastPurchase: null, months,
  }

  for (const order of orders) {
    const status = historyStatus(order)
    if (status === 'ON_HOLD') {
      summary.onHoldCount += 1
      summary.onHold += order.priceAtOrder
      continue
    }
    if (status === 'RELEASED') {
      summary.releasedCount += 1
      continue
    }
    const when = spendDate(order)
    summary.purchasedCount += 1
    summary.spent += order.priceAtOrder
    summary.saved += Math.max(0, order.askingAtOrder - order.priceAtOrder)
    summary.budgetCovered += Math.min(order.budgetApplied ?? 0, order.priceAtOrder)
    if (!summary.firstPurchase || when < summary.firstPurchase) summary.firstPurchase = when
    if (!summary.lastPurchase || when > summary.lastPurchase) summary.lastPurchase = when
    const month = byKey.get(monthKey(when))
    if (month) {
      month.spent += order.priceAtOrder
      month.count += 1
    }
  }

  summary.averageOrder = summary.purchasedCount
    ? Math.round(summary.spent / summary.purchasedCount)
    : 0
  return summary
}
