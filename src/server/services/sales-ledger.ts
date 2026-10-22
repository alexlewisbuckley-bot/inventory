import { findSales, type SaleListItem, type SaleQuery } from '../repositories/sale-repository'
import { listBrokerages } from './brokerage-service'

/**
 * The sales ledger: watches we sold, and fees we earned selling other
 * people's.
 *
 * One list, because that is how the business thinks about a month's
 * earnings — asking somebody to look in two places and add up is how a
 * figure gets missed.
 *
 * Merged here rather than in SQL. The two rows have genuinely different
 * shapes — a brokered deal has no stock number, no cost and no margin — so
 * a union would mean a column list of nulls and a rewrite of the ledger
 * query every other report depends on. At this scale the merge is a sort
 * over a few hundred rows.
 *
 * The cap is the honest limit of that choice: beyond it the sales query
 * would be paging in the database and this would not, so it refuses to
 * guess rather than quietly showing a short list. Revisit with a union if
 * the ledger ever gets near it.
 */
const MERGE_CAP = 2000

/** A commission row carries a marker; a sale row is the default. */
export type LedgerRow = SaleListItem & { kind: 'SALE' | 'COMMISSION' }

export interface Ledger {
  items: LedgerRow[]
  total: number
  page: number
  perPage: number
  /** True when there were more rows than the merge can order honestly. */
  truncated: boolean
}

export async function findSalesLedger(query: SaleQuery): Promise<Ledger> {
  const page = Math.max(1, query.page ?? 1)
  const perPage = Math.min(200, query.perPage ?? 25)

  /*
   * A sale-specific filter excludes commissions by construction.
   *
   * Channel, a stock number, a supplier — a brokered deal has none of
   * them, so a filtered view is asking about stock sales and showing a
   * commission in it would be answering a different question.
   */
  const stockOnly = Boolean(query.channel?.length || query.q || query.f?.length)

  const [sales, brokered] = await Promise.all([
    findSales({ ...query, page: 1, perPage: MERGE_CAP }),
    stockOnly ? Promise.resolve([]) : listBrokerages(query.from, query.to, MERGE_CAP),
  ])

  const commissions: LedgerRow[] = brokered.map((row) => ({
    kind: 'COMMISSION',
    id: row.id,
    invoiceNo: row.reference ?? '—',
    saleDate: row.brokeredOn,
    saleAmount: row.feeAmount,
    saleCurrency: row.feeCurrency as SaleListItem['saleCurrency'],
    paymentStatus: row.paymentStatus as SaleListItem['paymentStatus'],
    deliveryStatus: 'COLLECTED',
    customerCompany: null,
    notes: row.notes,
    purchaseAmount: null,
    purchaseCurrency: 'AED',
    soldById: null,
    soldByName: row.soldByName,
    // The fee is both what was invoiced and what was made: nothing was
    // bought, so there is no cost to take off it.
    amountUsd: row.feeBase,
    amountGbp: row.feeBase,
    profitUsd: row.feeBase,
    profitGbp: row.feeBase,
    // Margin on a thing with no cost is not 100%, it is undefined. Zero
    // here and the table prints a dash rather than a number to average.
    marginBps: 0,
    channel: 'RETAIL',
    customerName: row.soldTo ?? row.soldFor,
    stockNo: 0,
    watchId: '',
    model: row.description,
    brandName: 'Commission',
    supplierName: row.soldFor ?? '—',
    costGbp: 0,
    costUsd: null,
    vsEstimateGbp: null,
    recordedByName: '',
  }))

  const merged = [...sales.items.map((item) => ({ ...item, kind: 'SALE' as const })), ...commissions]
  const direction = query.dir === 'asc' ? 1 : -1
  merged.sort((a, b) => {
    switch (query.sort) {
      case 'amount': return (a.amountGbp - b.amountGbp) * direction
      case 'profit': return (a.profitGbp - b.profitGbp) * direction
      case 'margin': return (a.marginBps - b.marginBps) * direction
      case 'stockNo': return (a.stockNo - b.stockNo) * direction
      default: return (a.saleDate.getTime() - b.saleDate.getTime()) * direction
    }
  })

  const start = (page - 1) * perPage
  return {
    items: merged.slice(start, start + perPage),
    total: merged.length,
    page,
    perPage,
    truncated: sales.total > MERGE_CAP,
  }
}
