import { and, asc, count, desc, eq, gte, inArray, isNull, like, lte, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { liveSale } from '../db/predicates'
import { brands, locations, sales, salesPeople, suppliers, users, watches } from '../db/schema'
import { filtersToSql, type ColumnMap } from './filter-sql'
import { SALE_FIELDS, type FilterClause } from '@/lib/filters'
import type {
  CurrencyCode, DeliveryStatus, PaymentStatus, SaleChannel,
} from '@/lib/enums'

export interface SaleListItem {
  id: string
  invoiceNo: string
  saleDate: Date
  /**
   * The amount and currency as actually agreed, alongside the base figures.
   *
   * Carried so a correction opens on what was typed rather than on a
   * conversion of it: a sale struck at 55,000 dirhams should reappear as
   * 55,000 dirhams, not as the dollar figure it was converted to and back.
   * `saleAmount` is null on sales booked before the column existed, where the
   * base figure is all there is.
   */
  saleAmount: number | null
  saleCurrency: CurrencyCode
  paymentStatus: PaymentStatus
  deliveryStatus: DeliveryStatus
  customerCompany: string | null
  notes: string | null
  /**
   * What the watch cost, as agreed. The base figure is `costGbp`; these two
   * are what was actually typed, so a correction opens on the same number
   * rather than on a conversion of it.
   */
  purchaseAmount: number | null
  purchaseCurrency: CurrencyCode
  /**
   * Who sold it, as against `recordedByName`, who typed it in. Null on every
   * sale booked before the list existed, and the reports say so rather than
   * guessing.
   */
  soldById: string | null
  soldByName: string | null
  amountUsd: number
  amountGbp: number
  profitUsd: number
  profitGbp: number
  marginBps: number
  channel: SaleChannel
  customerName: string | null
  stockNo: number
  watchId: string
  model: string
  brandName: string
  supplierName: string
  costGbp: number
  costUsd: number | null
  /** Difference between realised price and the estimate set before sale, GBP. */
  vsEstimateGbp: number | null
  recordedByName: string
}

export interface SaleQuery {
  q?: string
  /** V2 filter clauses, already validated by src/lib/filters.ts. */
  f?: FilterClause[]
  channel?: SaleChannel[]
  from?: Date
  to?: Date
  sort?: 'saleDate' | 'amount' | 'profit' | 'margin' | 'stockNo'
  dir?: 'asc' | 'desc'
  page?: number
  perPage?: number
}

function filters(query: SaleQuery): SQL | undefined {
  const clauses: (SQL | undefined)[] = [liveSale()]
  if (query.q) {
    const term = `%${query.q.toLowerCase()}%`
    clauses.push(or(
      like(sql`lower(${sales.invoiceNo})`, term),
      like(sql`lower(${sales.customerName})`, term),
      like(sql`lower(${salesPeople.name})`, term),
      like(sql`lower(${watches.model})`, term),
      like(sql`cast(${watches.stockNo} as text)`, term),
    ))
  }
  if (query.channel?.length) clauses.push(inArray(sales.channel, query.channel))
  if (query.from) clauses.push(gte(sales.saleDate, query.from))
  if (query.to) clauses.push(lte(sales.saleDate, query.to))

  const grammar = filtersToSql(query.f ?? [], SALE_COLUMNS, SALE_FIELDS)
  if (grammar) clauses.push(grammar)

  const present = clauses.filter(Boolean) as SQL[]
  return present.length > 0 ? and(...present) : undefined
}

/** Which column each filterable sale field means. */
const SALE_COLUMNS: ColumnMap = {
  channel: { column: sales.channel, kind: 'enum' },
  paymentStatus: { column: sales.paymentStatus, kind: 'enum' },
  deliveryStatus: { column: sales.deliveryStatus, kind: 'enum' },
  saleAmountGbp: { column: sales.saleAmountGbp, kind: 'money' },
  profitGbp: { column: sales.profitGbp, kind: 'money' },
  saleDate: { column: sales.saleDate, kind: 'date' },
  soldById: { column: sales.soldById, kind: 'enum' },
}

function order(query: SaleQuery): SQL {
  const direction = query.dir === 'asc' ? asc : desc
  switch (query.sort) {
    case 'amount': return direction(sales.saleAmountGbp)
    case 'profit': return direction(sales.profitGbp)
    case 'margin': return direction(sales.marginBps)
    case 'stockNo': return direction(watches.stockNo)
    case 'saleDate':
    default: return direction(sales.saleDate)
  }
}

export async function findSales(query: SaleQuery) {
  const page = Math.max(1, query.page ?? 1)
  const perPage = Math.min(200, query.perPage ?? 25)
  const where = filters(query)

  const [rows, totals] = await Promise.all([
    db.select({
      id: sales.id, invoiceNo: sales.invoiceNo, saleDate: sales.saleDate,
      amountUsd: sales.saleAmountUsd, amountGbp: sales.saleAmountGbp,
      profitUsd: sales.profitUsd, profitGbp: sales.profitGbp, marginBps: sales.marginBps,
      channel: sales.channel, customerName: sales.customerName,
      saleAmount: sales.saleAmount, saleCurrency: sales.saleCurrency,
      paymentStatus: sales.paymentStatus, deliveryStatus: sales.deliveryStatus,
      customerCompany: sales.customerCompany, notes: sales.notes,
      purchaseAmount: watches.purchaseAmount, purchaseCurrency: watches.purchaseCurrency,
      soldById: sales.soldById, soldByName: salesPeople.name,
      stockNo: watches.stockNo, watchId: watches.id, model: watches.model,
      costGbp: watches.purchasePriceGbp, costUsd: watches.purchasePriceUsd,
      estSaleGbp: watches.estSaleGbp,
      brandName: brands.name, supplierName: suppliers.name, recordedByName: users.name,
    })
      .from(sales)
      .innerJoin(watches, eq(watches.id, sales.watchId))
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .innerJoin(suppliers, eq(suppliers.id, watches.supplierId))
      .innerJoin(users, eq(users.id, sales.recordedById))
      // Left, not inner: a sale with nobody against it is still a sale, and
      // an inner join would quietly drop every historical row from the
      // ledger.
      .leftJoin(salesPeople, eq(salesPeople.id, sales.soldById))
      .where(where)
      .orderBy(order(query))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ value: count() })
      .from(sales)
      .innerJoin(watches, eq(watches.id, sales.watchId))
      // The same joins as the page query above: the search clause can name a
      // salesperson, and a count whose FROM list is narrower than the WHERE
      // it is given is a query that does not run at all.
      .leftJoin(salesPeople, eq(salesPeople.id, sales.soldById))
      .where(where),
  ])

  const total = Number(totals[0]?.value ?? 0)
  return {
    items: rows.map((row): SaleListItem => ({
      ...row,
      channel: row.channel as SaleChannel,
      saleCurrency: row.saleCurrency as CurrencyCode,
      paymentStatus: row.paymentStatus as PaymentStatus,
      deliveryStatus: row.deliveryStatus as DeliveryStatus,
      purchaseCurrency: row.purchaseCurrency as CurrencyCode,
      vsEstimateGbp: row.estSaleGbp !== null ? row.amountGbp - row.estSaleGbp : null,
    })),
    total, page, perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
  }
}

export interface SalesSummary {
  count: number
  /** GBP minor units — the display layer converts to the viewer's currency. */
  revenueGbp: number
  profitGbp: number
  avgMarginBps: number
  bestMarginBps: number | null
  worstMarginBps: number | null
}

export async function summariseSales(query: SaleQuery): Promise<SalesSummary> {
  const rows = await db
    .select({
      count: count(),
      revenue: sql<number>`coalesce(sum(${sales.saleAmountGbp}), 0)`,
      profit: sql<number>`coalesce(sum(${sales.profitGbp}), 0)`,
      // Weighted by cost rather than a mean of percentages, which would
      // over-weight small watches.
      cost: sql<number>`coalesce(sum(${watches.purchasePriceGbp}), 0)`,
      best: sql<number | null>`max(${sales.marginBps})`,
      worst: sql<number | null>`min(${sales.marginBps})`,
    })
    .from(sales)
    .innerJoin(watches, eq(watches.id, sales.watchId))
    .leftJoin(salesPeople, eq(salesPeople.id, sales.soldById))
    .where(filters(query))

  const row = rows[0]
  const cost = Number(row?.cost ?? 0)
  const profit = Number(row?.profit ?? 0)
  return {
    count: Number(row?.count ?? 0),
    revenueGbp: Number(row?.revenue ?? 0),
    profitGbp: profit,
    avgMarginBps: cost > 0 ? Math.round((profit / cost) * 10_000) : 0,
    bestMarginBps: row?.best !== null && row?.best !== undefined ? Number(row.best) : null,
    worstMarginBps: row?.worst !== null && row?.worst !== undefined ? Number(row.worst) : null,
  }
}

/** Monthly revenue and profit series for the reports chart. */
export async function salesByMonth(months = 12) {
  const since = new Date()
  since.setMonth(since.getMonth() - months)
  return db
    .select({
      month: sql<string>`to_char(${sales.saleDate}, 'YYYY-MM')`,
      count: count(),
      revenue: sql<number>`coalesce(sum(${sales.saleAmountGbp}), 0)`,
      profit: sql<number>`coalesce(sum(${sales.profitGbp}), 0)`,
    })
    .from(sales)
    .where(and(liveSale(), gte(sales.saleDate, since)))
    .groupBy(sql`to_char(${sales.saleDate}, 'YYYY-MM')`)
    .orderBy(asc(sql`to_char(${sales.saleDate}, 'YYYY-MM')`))
}

/** Purchase volume and realised margin grouped by supplier. */
export async function supplierPerformance() {
  return db
    .select({
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      watchCount: count(watches.id),
      totalCostGbp: sql<number>`coalesce(sum(${watches.purchasePriceGbp}), 0)`,
      soldCount: sql<number>`coalesce(sum(case when ${watches.status} = 'SOLD' then 1 else 0 end), 0)`,
      realisedProfitGbp: sql<number>`coalesce(sum(coalesce(${sales.profitGbp}, 0)), 0)`,
    })
    .from(suppliers)
    .leftJoin(watches, and(eq(watches.supplierId, suppliers.id), isNull(watches.deletedAt)))
    .leftJoin(sales, and(eq(sales.watchId, watches.id), liveSale()))
    .where(isNull(suppliers.deletedAt))
    .groupBy(suppliers.id)
    // A performance report is about suppliers you have actually bought from.
    // Listing every name on file put nine rows of zeroes above the two that
    // matter.
    .having(sql`count(${watches.id}) > 0`)
    .orderBy(desc(sql`coalesce(sum(${watches.purchasePriceGbp}), 0)`))
}

/**
 * What each person sold, for the month-end conversation.
 *
 * Counts live sales only — a voided invoice is not a sale anybody should be
 * credited with — and includes the sales nobody is recorded against as a row
 * of their own, because a report that quietly drops them makes the totals
 * disagree with the ledger and nobody can see why.
 */
export async function salesByPerson(from?: Date, to?: Date, onlyPersonId?: string) {
  const window: (SQL | undefined)[] = [liveSale()]
  if (from) window.push(gte(sales.saleDate, from))
  if (to) window.push(lte(sales.saleDate, to))
  // Scoped at the query, not filtered after it. A salesperson's own figures
  // are the only rows that leave the database for them, so there is nothing
  // in the payload for a filter to fail to remove.
  if (onlyPersonId) window.push(eq(sales.soldById, onlyPersonId))

  return db
    .select({
      personId: sales.soldById,
      // Coalesced here rather than in the component, so the sort below puts
      // the unattributed row where its figures belong rather than at the end.
      personName: sql<string>`coalesce(${salesPeople.name}, 'Not recorded')`,
      soldCount: count(sales.id),
      revenueGbp: sql<number>`coalesce(sum(${sales.saleAmountGbp}), 0)`,
      profitGbp: sql<number>`coalesce(sum(${sales.profitGbp}), 0)`,
      // Weighted by cost rather than a mean of percentages, which would
      // over-weight the cheap watches — the same way the ledger's own
      // summary does it, so the two agree.
      costGbp: sql<number>`coalesce(sum(${watches.purchasePriceGbp}), 0)`,
      /**
       * The day each person last closed something.
       *
       * On a leaderboard this is the difference between "second place" and
       * "second place, and nothing since August" — the one column that says
       * whether a rank is current or a residue of a good quarter.
       */
      lastSaleAt: sql<Date | null>`max(${sales.saleDate})`,
    })
    .from(sales)
    .innerJoin(watches, eq(watches.id, sales.watchId))
    .leftJoin(salesPeople, eq(salesPeople.id, sales.soldById))
    .where(and(...window.filter(Boolean) as SQL[]))
    .groupBy(sales.soldById, salesPeople.name)
    .orderBy(desc(sql`coalesce(sum(${sales.profitGbp}), 0)`))
}

/**
 * What each salesperson earned in one month.
 *
 * The rule, in one place so it cannot be half-implemented somewhere else: a
 * retainer every month, and a share of the profit on their own sales above
 * it. Monthly and fresh — a quiet month earns no commission and owes nothing
 * forward — and cleared by the profit on the sales with their name on rather
 * than by the business doing well.
 *
 * Paid and unpaid are counted separately and both are returned. Which one a
 * commission is owed on is a decision about money that belongs to whoever
 * signs the cheque, not to this function: showing only the paid figure would
 * hide what is coming, and showing only the total would pay somebody for an
 * invoice the customer has not settled.
 *
 * Everybody active is returned, including the people who sold nothing. A
 * commission run that lists only the earners is a commission run that
 * silently drops the person on a retainer and no sales — who is precisely
 * the one somebody needs to see.
 */
export async function commissionForMonth(from: Date, to: Date) {
  const earned = db
    .select({
      personId: sales.soldById,
      paidProfit: sql<number>`coalesce(sum(${sales.profitGbp}) filter (where ${sales.paymentStatus} = 'PAID'), 0)`.as('paid_profit'),
      paidCount: sql<number>`count(*) filter (where ${sales.paymentStatus} = 'PAID')`.as('paid_count'),
      pendingProfit: sql<number>`coalesce(sum(${sales.profitGbp}) filter (where ${sales.paymentStatus} <> 'PAID'), 0)`.as('pending_profit'),
      pendingCount: sql<number>`count(*) filter (where ${sales.paymentStatus} <> 'PAID')`.as('pending_count'),
    })
    .from(sales)
    .where(and(liveSale(), gte(sales.saleDate, from), lte(sales.saleDate, to)))
    .groupBy(sales.soldById)
    .as('earned')

  return db
    .select({
      personId: salesPeople.id,
      name: salesPeople.name,
      retainer: salesPeople.retainer,
      commissionBps: salesPeople.commissionBps,
      paidProfit: sql<number>`coalesce(${earned.paidProfit}, 0)`,
      paidCount: sql<number>`coalesce(${earned.paidCount}, 0)`,
      pendingProfit: sql<number>`coalesce(${earned.pendingProfit}, 0)`,
      pendingCount: sql<number>`coalesce(${earned.pendingCount}, 0)`,
    })
    .from(salesPeople)
    .leftJoin(earned, eq(earned.personId, salesPeople.id))
    .where(and(eq(salesPeople.isActive, true), isNull(salesPeople.deletedAt)))
    .orderBy(asc(salesPeople.sortOrder), asc(salesPeople.name))
}

/**
 * One month's trading, for the top of the profit and loss.
 *
 * Accrual: a sale counts in the month it was invoiced, whether or not the
 * customer has paid, which is how a P&L reads and how the accounts will
 * read. What has actually come in is returned alongside rather than instead,
 * because the gap between the two is the thing a dealer wants to see — a
 * strong month on paper with nothing banked is a different month.
 *
 * Cost of stock is derived from revenue less profit rather than summed from
 * the watch, so the three lines of the statement are guaranteed to add up.
 * Joining the watch and summing its cost separately would let a corrected
 * sale leave gross profit disagreeing with its own arithmetic.
 */
export async function tradingForMonth(from: Date, to: Date) {
  const rows = await db
    .select({
      invoiced: sql<number>`coalesce(sum(${sales.saleAmountGbp}), 0)`,
      profit: sql<number>`coalesce(sum(${sales.profitGbp}), 0)`,
      count: sql<number>`count(*)`,
      received: sql<number>`coalesce(sum(${sales.saleAmountGbp}) filter (where ${sales.paymentStatus} = 'PAID'), 0)`,
      unpaid: sql<number>`coalesce(sum(${sales.saleAmountGbp}) filter (where ${sales.paymentStatus} <> 'PAID'), 0)`,
    })
    .from(sales)
    .where(and(liveSale(), gte(sales.saleDate, from), lte(sales.saleDate, to)))

  const row = rows[0]
  const invoiced = Number(row?.invoiced ?? 0)
  const grossProfit = Number(row?.profit ?? 0)
  return {
    invoiced,
    grossProfit,
    costOfStock: invoiced - grossProfit,
    count: Number(row?.count ?? 0),
    received: Number(row?.received ?? 0),
    unpaid: Number(row?.unpaid ?? 0),
  }
}

/**
 * The commission one month's figures come to.
 *
 * The retainer is an advance against commission, not a slice taken off the
 * profit first. A quarter of everything the person's own sales made is what
 * they earn; the retainer has already been paid out of it, so only the part
 * above the retainer is money they see on top.
 *
 * On AED 7,500 of profit against a AED 4,085 retainer: the quarter is
 * AED 1,875, which is 46% of the way to the retainer, so nothing further is
 * due. Taking the retainer off the profit first and then a quarter of the
 * remainder would have paid AED 854 — a real payment, for a month that had
 * not covered the advance.
 *
 * Pure arithmetic, kept out of the component so the one calculation
 * anybody is paid against can be tested without a browser. Rounded half-up
 * at the last step only: rounding the profit first and the share second
 * loses a fils per person per month, which is nothing until somebody
 * reconciles it against the bank and cannot find it.
 */
export function commissionOn(
  profitBase: number, retainerBase: number, bps: number,
): { earned: number; commission: number } {
  // A month that lost money earns nothing. It does not earn a negative that
  // would quietly claw back the retainer.
  const earned = Math.round((Math.max(0, profitBase) * bps) / 10_000)
  return { earned, commission: Math.max(0, earned - retainerBase) }
}

export { locations }
