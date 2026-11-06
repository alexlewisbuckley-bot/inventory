import { findSales, type SaleListItem, type SaleQuery } from '../repositories/sale-repository'
import type { FilterClause } from '@/lib/filters'
import { listBrokerages } from './brokerage-service'
import { listBuybackCharges } from './buyback-service'

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

/**
 * What kind of thing earned the money.
 *
 * A sale row is the default. A commission is a fee on somebody else's
 * watch; a buy-back charge is interest or an extension fee on money we
 * lent. All three are earnings, none of the last two has a cost under it,
 * and they belong in one list because that is how a month is thought
 * about.
 */
export type LedgerKind = 'SALE' | 'COMMISSION' | 'BUYBACK'
export type LedgerRow = SaleListItem & { kind: LedgerKind }

export interface Ledger {
  items: LedgerRow[]
  total: number
  page: number
  perPage: number
  /** True when there were more rows than the merge can order honestly. */
  truncated: boolean
}

/** Which of the two fee ledgers a query is asking for. */
export interface FeeArms {
  /** Fees earned selling somebody else's watch. */
  commissions: boolean
  /** Interest and extension fees on money lent. */
  charges: boolean
}

/**
 * Does this clause let a row of that channel through?
 *
 * `is` and `isNot` are the only operators an enum field offers, so anything
 * else is a clause that cannot be reasoned about and the row stays out.
 */
function admits(clause: FilterClause, channel: string): boolean {
  if (clause.operator === 'is') return clause.values.includes(channel)
  if (clause.operator === 'isNot') return !clause.values.includes(channel)
  return false
}

/**
 * Which fee rows belong in a filtered view.
 *
 * This was one boolean, `stockSalesOnly`, and it had gone wrong twice for
 * the same reason: it decided for both ledgers at once and it read the
 * wrong parameter.
 *
 * The wrong parameter first. The rule was written against `channel=`, and
 * made an exception for Commission so that filtering to Commission did not
 * return an empty list — "the filter they are the whole point of". Then
 * channel moved into the shared filter bar, which writes `f=` clauses, and
 * the exception stopped applying to the only path the interface still uses.
 * Picking Commission in the filter bar has returned nothing ever since,
 * silently, because every `f=` clause was read as a question about stock.
 *
 * And both ledgers at once. Buy-back is a channel too, and it never had an
 * exception on either path — so filtering to Buy-back returned an empty
 * list from the day the channel existed. One boolean could not have fixed
 * that without also putting commissions in the Buy-back view.
 *
 * So: a channel clause is answered per ledger, from the clause itself. Any
 * other field drops both, which is the original rule and still right — a
 * stock number or a payment status is a question these rows are not in a
 * position to answer, because the clause is applied in SQL against the
 * sales table and the fee ledgers are not in it. Including them would show
 * rows the filter never tested.
 *
 * Exported so the rule can be tested as a rule, rather than pinned as a
 * line of source.
 */
export function feeArms(query: SaleQuery): FeeArms {
  const neither: FeeArms = { commissions: false, charges: false }

  // A text search is a question about stock: a fee has no stock number and
  // no supplier for the needle to match.
  if (query.q) return neither

  const clauses = query.f ?? []
  const channelClauses = clauses.filter((clause) => clause.field === 'channel')
  if (clauses.length > channelClauses.length) return neither

  if (channelClauses.length > 0) {
    return {
      commissions: channelClauses.every((clause) => admits(clause, 'COMMISSION')),
      charges: channelClauses.every((clause) => admits(clause, 'BUYBACK')),
    }
  }

  // The older `channel=` parameter. Nothing in the interface writes it any
  // more, but a saved view or a bookmarked URL from before the filter bar
  // took channel over still can.
  const channels = query.channel ?? []
  if (channels.length > 0) {
    return {
      commissions: channels.includes('COMMISSION'),
      charges: channels.includes('BUYBACK'),
    }
  }

  return { commissions: true, charges: true }
}

export async function findSalesLedger(query: SaleQuery): Promise<Ledger> {
  const page = Math.max(1, query.page ?? 1)
  const perPage = Math.min(200, query.perPage ?? 25)

  const arms = feeArms(query)

  const [sales, brokered, charges] = await Promise.all([
    findSales({ ...query, page: 1, perPage: MERGE_CAP }),
    arms.commissions ? listBrokerages(query.from, query.to, MERGE_CAP) : Promise.resolve([]),
    arms.charges ? listBuybackCharges(query.from, query.to, MERGE_CAP) : Promise.resolve([]),
  ])

  const commissions: LedgerRow[] = brokered.map((row) => ({
    kind: 'COMMISSION',
    id: row.id,
    invoiceNo: row.reference ?? '—',
    // A fee stands alone: there is no invoice of ours with other watches on it.
    invoiceLines: 1,
    saleDate: row.brokeredOn,
    saleAmount: row.feeAmount,
    saleCurrency: row.feeCurrency as SaleListItem['saleCurrency'],
    paymentStatus: row.paymentStatus as SaleListItem['paymentStatus'],
    deliveryStatus: 'COLLECTED',
    // A fee carries no due date and no paid date of its own, but it is
    // very much measured against an import: hard-coding this null left
    // every commission reading "Not in Xero" for good, however well it
    // had just reconciled.
    dueOn: null,
    paidOn: null,
    xeroSeenImportId: row.xeroSeenImportId,
    customerCompany: null,
    notes: row.notes,
    purchaseAmount: null,
    purchaseCurrency: 'AED',
    // Carried, not nulled. The correction form needs the current name to
    // open on, and a commission's salesperson is the one field on it that
    // decides whose commission run the fee lands in.
    soldById: row.soldById,
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
    // Not retail — it never was. The column printed a dash, so the lie
    // was invisible; now the row says what kind of deal it was.
    channel: 'COMMISSION',
    customerName: row.soldTo ?? row.soldFor,
    /*
     * A linked fee carries its watch like any other row.
     *
     * These were hardcoded blank, so a commission linked to one of our
     * own watches still showed no stock number and could not be opened —
     * the link was recorded and then thrown away on the way to the screen.
     */
    stockNo: row.stockNo ?? 0,
    watchId: row.watchId ?? '',
    model: row.model ?? row.description,
    brandName: row.brandName ?? 'Commission',
    supplierName: row.soldFor ?? '—',
    costGbp: 0,
    costUsd: null,
    vsEstimateGbp: null,
    recordedByName: '',
  }))

  /*
   * Interest and extension fees, as ledger rows.
   *
   * The principal is not here and never will be: lending it is not a cost
   * and getting it back is not income, so putting either in the ledger
   * would make a month read as a windfall or a disaster depending on which
   * way the money happened to move that week. Only what was earned.
   */
  const buybackRows: LedgerRow[] = charges.map((row) => ({
    kind: 'BUYBACK',
    id: row.id,
    // Its own invoice number where Xero has given it one; the loan's
    // reference otherwise.
    invoiceNo: row.invoiceNo ?? row.reference ?? '—',
    invoiceLines: 1,
    saleDate: row.dueOn,
    saleAmount: row.amount,
    saleCurrency: row.currency as SaleListItem['saleCurrency'],
    paymentStatus: row.paymentStatus as SaleListItem['paymentStatus'],
    deliveryStatus: 'COLLECTED',
    // The charge's own due date is its sale date on this row, so there is
    // nothing separate to put here. The import, though, is real.
    dueOn: null,
    paidOn: null,
    xeroSeenImportId: row.xeroSeenImportId,
    customerCompany: null,
    notes: null,
    purchaseAmount: null,
    purchaseCurrency: 'AED',
    soldById: null,
    soldByName: row.soldByName,
    // Nothing was bought, so the whole charge is the profit — the same way
    // a brokered fee is, and for the same reason.
    amountUsd: row.amountBase,
    amountGbp: row.amountBase,
    profitUsd: row.amountBase,
    profitGbp: row.amountBase,
    marginBps: 0,
    channel: 'BUYBACK',
    customerName: row.customerName,
    stockNo: 0,
    watchId: '',
    // Which month it is, where it is a month. "Interest, month 4" is what
    // makes a column of identical figures explainable a year later.
    model: row.kind === 'EXTENSION'
      ? 'Extension fee'
      : `Interest${row.periodIndex ? `, month ${row.periodIndex}` : ''}`,
    brandName: 'Buy-back',
    supplierName: row.customerName,
    costGbp: 0,
    costUsd: null,
    vsEstimateGbp: null,
    recordedByName: '',
  }))

  const merged = [...sales.items.map((item) => ({ ...item, kind: 'SALE' as const })), ...commissions, ...buybackRows]
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
