/**
 * Dashboard aggregates.
 *
 * These queries exist only to answer "what should I do next?" — they are kept
 * out of the watch repository because they cut across watches, sales, images
 * and FX rates, and because they aggressively pre-aggregate in SQL rather than
 * returning rows for the page to reduce. Every figure the control centre shows
 * is one round trip.
 */

import { and, count, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { liveSale } from '../db/predicates'
import { fxRates, sales, watchImages, watches } from '../db/schema'
import { BASE_CURRENCY } from '@/lib/enums'

const DAY_MS = 86_400_000

/**
 * A timestamp N days back, as an ISO string.
 *
 * Deliberately a string, not a Date: postgres.js will not serialise a Date
 * bound inside a raw `sql` fragment and throws at query time, so every
 * comparison in this file binds ISO text and casts it explicitly.
 */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString()
}

const liveWatch = and(isNull(watches.deletedAt), sql`${watches.status} in ('IN_STOCK','RESERVED','SALE_AGREED')`)

export interface AgeBucket {
  key: string
  label: string
  count: number
  valueGbp: number
  /** True for buckets that represent capital sitting too long. */
  concerning: boolean
}

/**
 * Age distribution of live stock.
 *
 * Bucketed in SQL so the page never pulls every watch just to count them. The
 * boundaries mirror the trade's own language: a watch under a month is fresh,
 * over three months is a problem.
 */
export async function stockAgeBuckets(): Promise<AgeBucket[]> {
  const rows = await db
    .select({
      bucket: sql<string>`
        case
          when ${watches.purchaseDate} >= now() - interval '30 days' then 'fresh'
          when ${watches.purchaseDate} >= now() - interval '60 days' then 'settling'
          when ${watches.purchaseDate} >= now() - interval '90 days' then 'watch'
          when ${watches.purchaseDate} >= now() - interval '180 days' then 'ageing'
          else 'stale'
        end`.as('bucket'),
      count: count(),
      valueGbp: sql<number>`coalesce(sum(${watches.purchasePriceGbp}), 0)`,
    })
    .from(watches)
    .where(liveWatch)
    .groupBy(sql`1`)

  const byKey = new Map(rows.map((row) => [row.bucket, row]))
  const spec: Array<{ key: string; label: string; concerning: boolean }> = [
    { key: 'fresh', label: 'Under 30 days', concerning: false },
    { key: 'settling', label: '30–60 days', concerning: false },
    { key: 'watch', label: '60–90 days', concerning: false },
    { key: 'ageing', label: '90–180 days', concerning: true },
    { key: 'stale', label: 'Over 180 days', concerning: true },
  ]

  return spec.map((entry) => {
    const row = byKey.get(entry.key)
    return {
      ...entry,
      count: Number(row?.count ?? 0),
      valueGbp: Number(row?.valueGbp ?? 0),
    }
  })
}

export interface FlowMonth {
  /** ISO month, e.g. 2026-07. */
  month: string
  label: string
  boughtCount: number
  boughtGbp: number
  soldCount: number
  soldGbp: number
  profitGbp: number
}

/**
 * Purchases against sales, month by month.
 *
 * Two separate grouped queries stitched together in memory: a full outer join
 * in SQL would be harder to read for no measurable gain at this row count, and
 * the month spine is generated here so empty months are still plotted.
 */
export async function stockFlow(months = 6): Promise<FlowMonth[]> {
  const since = new Date()
  since.setUTCDate(1)
  since.setUTCHours(0, 0, 0, 0)
  since.setUTCMonth(since.getUTCMonth() - (months - 1))

  const [bought, sold] = await Promise.all([
    db
      .select({
        month: sql<string>`to_char(${watches.purchaseDate}, 'YYYY-MM')`.as('month'),
        count: count(),
        valueGbp: sql<number>`coalesce(sum(${watches.purchasePriceGbp}), 0)`,
      })
      .from(watches)
      .where(and(isNull(watches.deletedAt), gte(watches.purchaseDate, since)))
      .groupBy(sql`1`),
    db
      .select({
        month: sql<string>`to_char(${sales.saleDate}, 'YYYY-MM')`.as('month'),
        count: count(),
        valueGbp: sql<number>`coalesce(sum(${sales.saleAmountGbp}), 0)`,
        profitGbp: sql<number>`coalesce(sum(${sales.profitGbp}), 0)`,
      })
      .from(sales)
      .where(and(liveSale(), gte(sales.saleDate, since)))
      .groupBy(sql`1`),
  ])

  const boughtByMonth = new Map(bought.map((row) => [row.month, row]))
  const soldByMonth = new Map(sold.map((row) => [row.month, row]))

  return monthSpine(since, months).map((entry) => {
    const b = boughtByMonth.get(entry.month)
    const s = soldByMonth.get(entry.month)
    return {
      ...entry,
      boughtCount: Number(b?.count ?? 0),
      boughtGbp: Number(b?.valueGbp ?? 0),
      soldCount: Number(s?.count ?? 0),
      soldGbp: Number(s?.valueGbp ?? 0),
      profitGbp: Number(s?.profitGbp ?? 0),
    }
  })
}

/**
 * The continuous run of months to plot, oldest first.
 *
 * Generated rather than derived from the rows, so a month in which nothing was
 * bought or sold still appears on the axis. A gap-free axis is the difference
 * between "we did nothing in June" and "June is missing from this chart".
 */
export function monthSpine(since: Date, months: number): Array<{ month: string; label: string }> {
  const spine: Array<{ month: string; label: string }> = []
  for (let i = 0; i < months; i += 1) {
    const date = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1))
    spine.push({
      month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }),
    })
  }
  return spine
}

export interface PeriodComparison {
  count: number
  revenueGbp: number
  profitGbp: number
  previousCount: number
  previousRevenueGbp: number
  previousProfitGbp: number
}

/**
 * Trading over the last N days against the N days before that.
 *
 * A single scan over both windows: the CASE arms keep it to one pass, which
 * matters more for correctness than speed here — both figures come from the
 * same snapshot, so they can never disagree.
 */
export async function salesComparison(days = 30): Promise<PeriodComparison> {
  const start = daysAgo(days)
  const previousStart = daysAgo(days * 2)

  const [row] = await db
    .select({
      count: sql<number>`coalesce(sum(case when ${sales.saleDate} >= ${start}::timestamptz then 1 else 0 end), 0)`,
      revenueGbp: sql<number>`coalesce(sum(case when ${sales.saleDate} >= ${start}::timestamptz then ${sales.saleAmountGbp} else 0 end), 0)`,
      profitGbp: sql<number>`coalesce(sum(case when ${sales.saleDate} >= ${start}::timestamptz then ${sales.profitGbp} else 0 end), 0)`,
      previousCount: sql<number>`coalesce(sum(case when ${sales.saleDate} < ${start}::timestamptz then 1 else 0 end), 0)`,
      previousRevenueGbp: sql<number>`coalesce(sum(case when ${sales.saleDate} < ${start}::timestamptz then ${sales.saleAmountGbp} else 0 end), 0)`,
      previousProfitGbp: sql<number>`coalesce(sum(case when ${sales.saleDate} < ${start}::timestamptz then ${sales.profitGbp} else 0 end), 0)`,
    })
    .from(sales)
    .where(and(liveSale(), gte(sales.saleDate, new Date(previousStart))))

  return {
    count: Number(row?.count ?? 0),
    revenueGbp: Number(row?.revenueGbp ?? 0),
    profitGbp: Number(row?.profitGbp ?? 0),
    previousCount: Number(row?.previousCount ?? 0),
    previousRevenueGbp: Number(row?.previousRevenueGbp ?? 0),
    previousProfitGbp: Number(row?.previousProfitGbp ?? 0),
  }
}

/** Stock added in the last N days, for the "incoming" read on the tiles. */
export async function recentIntake(days = 30): Promise<{ count: number; valueGbp: number; previousCount: number }> {
  const start = daysAgo(days)
  const previousStart = daysAgo(days * 2)
  const [row] = await db
    .select({
      count: sql<number>`coalesce(sum(case when ${watches.purchaseDate} >= ${start}::timestamptz then 1 else 0 end), 0)`,
      valueGbp: sql<number>`coalesce(sum(case when ${watches.purchaseDate} >= ${start}::timestamptz then ${watches.purchasePriceGbp} else 0 end), 0)`,
      previousCount: sql<number>`coalesce(sum(case when ${watches.purchaseDate} < ${start}::timestamptz then 1 else 0 end), 0)`,
    })
    .from(watches)
    .where(and(isNull(watches.deletedAt), gte(watches.purchaseDate, new Date(previousStart))))

  return {
    count: Number(row?.count ?? 0),
    valueGbp: Number(row?.valueGbp ?? 0),
    previousCount: Number(row?.previousCount ?? 0),
  }
}

export interface AttentionCounts {
  unpriced: number
  ageing: number
  withoutImages: number
  saleAgreedStale: number
  reservedStale: number
  staleRates: number
  oldestRateAt: Date | null
}

const AGEING_DAYS = 90
const COMMITMENT_DAYS = 14
const RATE_STALE_DAYS = 30

/**
 * Everything the business should act on, counted in one round trip.
 *
 * Deliberately counts rather than fetches: the queue renders totals and links
 * into the filtered inventory view, so pulling rows here would be waste.
 */
export async function attentionCounts(): Promise<AttentionCounts> {
  const ageingBefore = daysAgo(AGEING_DAYS)
  const committedBefore = daysAgo(COMMITMENT_DAYS)
  const ratesStaleBefore = daysAgo(RATE_STALE_DAYS)

  const [stock, images, rates] = await Promise.all([
    db
      .select({
        unpriced: sql<number>`coalesce(sum(case when ${watches.estSaleGbp} is null or ${watches.estSaleGbp} = 0 then 1 else 0 end), 0)`,
        ageing: sql<number>`coalesce(sum(case when ${watches.purchaseDate} < ${ageingBefore}::timestamptz then 1 else 0 end), 0)`,
        saleAgreedStale: sql<number>`coalesce(sum(case when ${watches.status} = 'SALE_AGREED' and ${watches.updatedAt} < ${committedBefore}::timestamptz then 1 else 0 end), 0)`,
        reservedStale: sql<number>`coalesce(sum(case when ${watches.status} = 'RESERVED' and ${watches.updatedAt} < ${committedBefore}::timestamptz then 1 else 0 end), 0)`,
      })
      .from(watches)
      .where(liveWatch),
    db
      .select({ value: count() })
      .from(watches)
      .where(and(liveWatch, sql`not exists (select 1 from ${watchImages} where ${watchImages.watchId} = ${watches.id})`)),
    db
      .select({
        stale: sql<number>`coalesce(sum(case when ${fxRates.updatedAt} < ${ratesStaleBefore}::timestamptz then 1 else 0 end), 0)`,
        oldest: sql<Date | null>`min(${fxRates.updatedAt})`,
      })
      .from(fxRates)
      .where(sql`${fxRates.code} <> ${BASE_CURRENCY}`),
  ])

  return {
    unpriced: Number(stock[0]?.unpriced ?? 0),
    ageing: Number(stock[0]?.ageing ?? 0),
    withoutImages: Number(images[0]?.value ?? 0),
    saleAgreedStale: Number(stock[0]?.saleAgreedStale ?? 0),
    reservedStale: Number(stock[0]?.reservedStale ?? 0),
    staleRates: Number(rates[0]?.stale ?? 0),
    oldestRateAt: rates[0]?.oldest ? new Date(rates[0].oldest) : null,
  }
}

/** The live status mix, so the health card can show composition not just totals. */
export async function statusMix(): Promise<Array<{ status: string; count: number }>> {
  const rows = await db
    .select({ status: watches.status, count: count() })
    .from(watches)
    .where(and(isNull(watches.deletedAt), sql`${watches.status} <> 'SOLD'`))
    .groupBy(watches.status)

  return rows.map((row) => ({ status: row.status, count: Number(row.count) }))
}

/**
 * Brands ranked by capital held, so the buyer can see concentration risk.
 */
export async function capitalByBrand(limit = 5): Promise<Array<{ brandId: string; brandName: string; count: number; valueGbp: number }>> {
  const { brands } = await import('../db/schema')
  const rows = await db
    .select({
      brandId: brands.id,
      brandName: brands.name,
      count: count(),
      valueGbp: sql<number>`coalesce(sum(${watches.purchasePriceGbp}), 0)`,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(liveWatch)
    .groupBy(brands.id, brands.name)
    .orderBy(sql`3 desc`)
    .limit(limit)

  return rows.map((row) => ({ ...row, count: Number(row.count), valueGbp: Number(row.valueGbp) }))
}
