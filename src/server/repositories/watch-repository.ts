import { and, asc, count, desc, eq, gte, inArray, isNull, isNotNull, like, lte, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { liveSale } from '../db/predicates'
import { brands, locations, sales, suppliers, users, watches } from '../db/schema'
import type { WatchQuery } from '@/lib/validation'
import type { WatchStatus } from '@/lib/enums'

/**
 * Read model for the inventory list.
 *
 * Joined columns are flattened here so the UI never has to reach through
 * nested relations, and derived money figures are computed once server-side.
 */
export interface WatchListItem {
  id: string
  stockNo: number
  brandName: string
  model: string
  nickname: string | null
  serial: string | null
  supplierName: string
  supplierId: string
  locationName: string
  locationId: string
  purchaseDate: Date
  purchasePriceGbp: number
  purchasePriceUsd: number | null
  estSaleUsd: number | null
  /** Estimated sale price in GBP minor units — the base every figure derives from. */
  estSaleGbp: number | null
  estSaleCurrency: string
  /** Estimated profit in GBP minor units; null when the watch is unpriced. */
  estProfitGbp: number | null
  /** Retained for the legacy USD columns in exports. */
  estProfitUsd: number | null
  status: WatchStatus
  version: number
  deletedAt: Date | null
  /**
   * What the watch actually sold for, and the profit realised, both in GBP
   * minor units. These were carried as the USD columns and then rendered
   * through the GBP formatter, which inflated every sold row by the exchange
   * rate — a watch sold for £12,500 at £8,084 profit reported £10,752.
   */
  soldAmountGbp: number | null
  actualProfitGbp: number | null
}

export interface WatchListResult {
  items: WatchListItem[]
  total: number
  page: number
  perPage: number
  pages: number
}

/** Columns selected for the list view — kept narrow to avoid over-fetching. */
const listSelection = {
  id: watches.id,
  stockNo: watches.stockNo,
  model: watches.model,
  nickname: watches.nickname,
  serial: watches.serial,
  purchaseDate: watches.purchaseDate,
  purchasePriceGbp: watches.purchasePriceGbp,
  purchasePriceUsd: watches.purchasePriceUsd,
  estSaleUsd: watches.estSaleUsd,
  estSaleGbp: watches.estSaleGbp,
  estSaleCurrency: watches.estSaleCurrency,
  status: watches.status,
  version: watches.version,
  deletedAt: watches.deletedAt,
  brandName: brands.name,
  supplierName: suppliers.name,
  supplierId: suppliers.id,
  locationName: locations.name,
  locationId: locations.id,
  soldAmountGbp: sales.saleAmountGbp,
  actualProfitGbp: sales.profitGbp,
} as const

function buildFilters(query: WatchQuery): SQL | undefined {
  const clauses: (SQL | undefined)[] = []

  if (!query.includeDeleted) clauses.push(isNull(watches.deletedAt))

  if (query.q) {
    // Free-text across the identifiers staff actually quote to each other:
    // stock number, model reference, serial and nickname.
    const term = `%${query.q.toLowerCase()}%`
    clauses.push(
      or(
        like(sql`lower(${watches.model})`, term),
        like(sql`lower(${watches.serial})`, term),
        like(sql`lower(${watches.nickname})`, term),
        like(sql`lower(${brands.name})`, term),
        like(sql`cast(${watches.stockNo} as text)`, term),
      ),
    )
  }

  if (query.status?.length) clauses.push(inArray(watches.status, query.status))
  if (query.locationId?.length) clauses.push(inArray(watches.locationId, query.locationId))
  if (query.supplierId?.length) clauses.push(inArray(watches.supplierId, query.supplierId))
  if (query.brandId?.length) clauses.push(inArray(watches.brandId, query.brandId))
  if (query.unpricedOnly) clauses.push(isNull(watches.estSaleGbp))
  if (query.purchasedFrom) clauses.push(gte(watches.purchaseDate, query.purchasedFrom))
  if (query.purchasedTo) clauses.push(lte(watches.purchaseDate, query.purchasedTo))
  if (query.minPriceGbp !== undefined) clauses.push(gte(watches.purchasePriceGbp, Math.round(query.minPriceGbp * 100)))
  if (query.maxPriceGbp !== undefined) clauses.push(lte(watches.purchasePriceGbp, Math.round(query.maxPriceGbp * 100)))

  const present = clauses.filter(Boolean) as SQL[]
  return present.length > 0 ? and(...present) : undefined
}

function buildOrder(query: WatchQuery): SQL {
  const direction = query.dir === 'asc' ? asc : desc
  switch (query.sort) {
    case 'model': return direction(watches.model)
    case 'purchaseDate': return direction(watches.purchaseDate)
    case 'purchasePriceGbp': return direction(watches.purchasePriceGbp)
    case 'estSaleUsd': return direction(watches.estSaleUsd)
    case 'status': return direction(watches.status)
    case 'location': return direction(locations.name)
    // Sorting by margin needs the derived expression, not a stored column.
    case 'margin': return direction(sql`(${watches.estSaleGbp} - ${watches.purchasePriceGbp})`)
    case 'stockNo':
    default: return direction(watches.stockNo)
  }
}

/** Paginated, filtered, sorted inventory list. */
export async function findWatches(query: WatchQuery): Promise<WatchListResult> {
  const where = buildFilters(query)
  const offset = (query.page - 1) * query.perPage

  const [rows, totals] = await Promise.all([
    db.select(listSelection)
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .innerJoin(suppliers, eq(suppliers.id, watches.supplierId))
      .innerJoin(locations, eq(locations.id, watches.locationId))
      .leftJoin(sales, and(eq(sales.watchId, watches.id), liveSale()))
      .where(where)
      .orderBy(buildOrder(query))
      .limit(query.perPage)
      .offset(offset),
    db.select({ value: count() })
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(where),
  ])

  const total = Number(totals[0]?.value ?? 0)
  return {
    items: rows.map((row) => ({
      ...row,
      status: row.status as WatchStatus,
      estProfitUsd: row.estSaleUsd !== null && row.purchasePriceUsd !== null
        ? row.estSaleUsd - row.purchasePriceUsd
        : null,
      estProfitGbp: row.estSaleGbp !== null
        ? row.estSaleGbp - row.purchasePriceGbp
        : null,
    })),
    total,
    page: query.page,
    perPage: query.perPage,
    pages: Math.max(1, Math.ceil(total / query.perPage)),
  }
}

/** Aggregate KPIs for the current filter set — the header stat tiles. */
export interface InventorySummary {
  inStockCount: number
  totalCostGbp: number
  totalCostUsd: number
  estSaleUsd: number
  estProfitUsd: number
  /** Aggregates in GBP minor units — the figures the UI converts for display. */
  estSaleGbp: number
  estProfitGbp: number
  pricedCount: number
  unpricedCount: number
  avgCostGbp: number
}

export async function summariseInventory(query: WatchQuery): Promise<InventorySummary> {
  const where = buildFilters(query)
  const rows = await db
    .select({
      total: count(),
      cost: sql<number>`coalesce(sum(${watches.purchasePriceGbp}), 0)`,
      costUsd: sql<number>`coalesce(sum(${watches.purchasePriceUsd}), 0)`,
      sale: sql<number>`coalesce(sum(${watches.estSaleUsd}), 0)`,
      saleGbp: sql<number>`coalesce(sum(${watches.estSaleGbp}), 0)`,
      profitGbp: sql<number>`coalesce(sum(case when ${watches.estSaleGbp} is not null
        then ${watches.estSaleGbp} - ${watches.purchasePriceGbp} else 0 end), 0)`,
      priced: sql<number>`coalesce(sum(case when ${watches.estSaleGbp} is not null then 1 else 0 end), 0)`,
      // Only priced rows may contribute to estimated profit, otherwise the
      // figure silently understates by counting unpriced stock as zero revenue.
      profit: sql<number>`coalesce(sum(case when ${watches.estSaleUsd} is not null
        then ${watches.estSaleUsd} - coalesce(${watches.purchasePriceUsd}, 0) else 0 end), 0)`,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(where)

  const row = rows[0]
  const total = Number(row?.total ?? 0)
  const cost = Number(row?.cost ?? 0)
  const priced = Number(row?.priced ?? 0)

  return {
    inStockCount: total,
    totalCostGbp: cost,
    totalCostUsd: Number(row?.costUsd ?? 0),
    estSaleUsd: Number(row?.sale ?? 0),
    estProfitUsd: Number(row?.profit ?? 0),
    estSaleGbp: Number(row?.saleGbp ?? 0),
    estProfitGbp: Number(row?.profitGbp ?? 0),
    pricedCount: priced,
    unpricedCount: total - priced,
    avgCostGbp: total > 0 ? Math.round(cost / total) : 0,
  }
}

/** Full record for the detail drawer, including joined display names. */
export async function findWatchById(id: string) {
  const rows = await db
    .select({
      watch: watches,
      brand: brands,
      supplier: suppliers,
      location: locations,
      sale: sales,
      createdByName: users.name,
      createdByInitials: users.initials,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .innerJoin(suppliers, eq(suppliers.id, watches.supplierId))
    .innerJoin(locations, eq(locations.id, watches.locationId))
    .innerJoin(users, eq(users.id, watches.createdById))
    .leftJoin(sales, and(eq(sales.watchId, watches.id), liveSale()))
    .where(eq(watches.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function findWatchByStockNo(stockNo: number) {
  const rows = await db.select().from(watches).where(eq(watches.stockNo, stockNo)).limit(1)
  return rows[0] ?? null
}

/** Next stock number, continuing the spreadsheet's sequence. */
export async function nextStockNo(): Promise<number> {
  const rows = await db.select({ max: sql<number>`coalesce(max(${watches.stockNo}), 1399)` }).from(watches)
  return Number(rows[0]?.max ?? 1399) + 1
}

/** Watches held longer than `days`, oldest first — the ageing report. */
export async function findAgeingStock(days: number, limit = 20) {
  const cutoff = new Date(Date.now() - days * 86_400_000)
  return db
    .select({
      id: watches.id, stockNo: watches.stockNo, model: watches.model,
      brandName: brands.name, purchaseDate: watches.purchaseDate,
      purchasePriceGbp: watches.purchasePriceGbp, locationName: locations.name,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .innerJoin(locations, eq(locations.id, watches.locationId))
    .where(and(
      isNull(watches.deletedAt),
      lte(watches.purchaseDate, cutoff),
      inArray(watches.status, ['IN_STOCK', 'RESERVED']),
    ))
    .orderBy(asc(watches.purchaseDate))
    .limit(limit)
}

/** Stock counts and capital grouped by location, for the dashboard. */
export async function stockByLocation() {
  return db
    .select({
      locationId: locations.id,
      locationName: locations.name,
      type: locations.type,
      count: count(watches.id),
      valueGbp: sql<number>`coalesce(sum(${watches.purchasePriceGbp}), 0)`,
    })
    .from(locations)
    .leftJoin(watches, and(
      eq(watches.locationId, locations.id),
      isNull(watches.deletedAt),
      inArray(watches.status, ['IN_STOCK', 'RESERVED', 'SALE_AGREED']),
    ))
    .where(isNull(locations.deletedAt))
    .groupBy(locations.id)
    .orderBy(asc(locations.sortOrder))
}

/** Watches with no estimated sale price — a data-quality worklist. */
export async function countUnpriced(): Promise<number> {
  const rows = await db.select({ value: count() }).from(watches)
    .where(and(isNull(watches.deletedAt), isNull(watches.estSaleGbp), inArray(watches.status, ['IN_STOCK', 'RESERVED'])))
  return Number(rows[0]?.value ?? 0)
}

export { isNotNull }
