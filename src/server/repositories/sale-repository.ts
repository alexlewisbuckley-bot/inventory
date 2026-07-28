import { and, asc, count, desc, eq, gte, inArray, isNull, like, lte, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { liveSale } from '../db/predicates'
import { brands, locations, sales, suppliers, users, watches } from '../db/schema'
import type { SaleChannel } from '@/lib/enums'

export interface SaleListItem {
  id: string
  invoiceNo: string
  saleDate: Date
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
      like(sql`lower(${watches.model})`, term),
      like(sql`cast(${watches.stockNo} as text)`, term),
    ))
  }
  if (query.channel?.length) clauses.push(inArray(sales.channel, query.channel))
  if (query.from) clauses.push(gte(sales.saleDate, query.from))
  if (query.to) clauses.push(lte(sales.saleDate, query.to))
  const present = clauses.filter(Boolean) as SQL[]
  return present.length > 0 ? and(...present) : undefined
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
      .where(where)
      .orderBy(order(query))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ value: count() })
      .from(sales)
      .innerJoin(watches, eq(watches.id, sales.watchId))
      .where(where),
  ])

  const total = Number(totals[0]?.value ?? 0)
  return {
    items: rows.map((row): SaleListItem => ({
      ...row,
      channel: row.channel as SaleChannel,
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

export { locations }
