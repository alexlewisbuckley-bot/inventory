import { and, desc, eq, gte, isNull, lt, lte, ne, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { liveSale } from '../db/predicates'
import {
  brands, customers, deals, fxRates, offers, sales, tasks, watches, watchRequests,
} from '../db/schema'

/**
 * What is worth knowing today.
 *
 * The dashboard this replaces answered "what do we own?" — four metric tiles,
 * a flow chart, stock health, capital by location — to people whose job is
 * selling. Nothing on it told anybody what to do next, and a screen that opens
 * every morning and does not answer that question is a screen people learn to
 * scroll past. (Audit C-2.)
 *
 * Everything here answers one of two questions instead: what needs me, and
 * what changed while I was away.
 *
 * One rule runs through the whole file: **every line ends in something you can
 * do about it.** A fact with no action attached belongs in Insights, where it
 * is looked at deliberately, not on the screen somebody opens at 8am.
 */

const DAY = 86_400_000

// ---------------------------------------------------------------------------
// The two tiles
// ---------------------------------------------------------------------------

export interface PipelineSnapshot {
  openValueGbp: number
  weightedGbp: number
  openCount: number
  closingThisWeek: number
  /** Open deals per stage, in board order, for the sparkline. */
  byStage: Array<{ stage: string; count: number; valueGbp: number }>
}

export async function pipelineSnapshot(): Promise<PipelineSnapshot> {
  const weekEnd = new Date(Date.now() + 7 * DAY)

  const [rows, closing] = await Promise.all([
    db.select({
      stage: deals.stage,
      count: sql<number>`count(*)`,
      value: sql<number>`coalesce(sum(${deals.valueGbp}), 0)`,
      // Integer division deliberately: probability is whole percent and the
      // pennies are noise against a five-figure forecast.
      weighted: sql<number>`coalesce(sum(${deals.valueGbp} * ${deals.probability} / 100), 0)`,
    })
      .from(deals)
      .where(and(isNull(deals.deletedAt), ne(deals.stage, 'WON'), ne(deals.stage, 'LOST')))
      .groupBy(deals.stage),

    db.select({ value: sql<number>`count(*)` }).from(deals)
      .where(and(
        isNull(deals.deletedAt), ne(deals.stage, 'WON'), ne(deals.stage, 'LOST'),
        lte(deals.expectedClose, weekEnd.toISOString().slice(0, 10)),
      )),
  ])

  return {
    openValueGbp: rows.reduce((sum, row) => sum + Number(row.value), 0),
    weightedGbp: rows.reduce((sum, row) => sum + Number(row.weighted), 0),
    openCount: rows.reduce((sum, row) => sum + Number(row.count), 0),
    closingThisWeek: Number(closing[0]?.value ?? 0),
    byStage: rows.map((row) => ({
      stage: row.stage,
      count: Number(row.count),
      valueGbp: Number(row.value),
    })),
  }
}

export interface StockSnapshot {
  held: number
  capitalGbp: number
  unpriced: number
  ageing: number
}

export async function stockSnapshot(ageingDays = 90): Promise<StockSnapshot> {
  const cutoff = new Date(Date.now() - ageingDays * DAY)

  const [held, unpriced, ageing] = await Promise.all([
    db.select({
      count: sql<number>`count(*)`,
      capital: sql<number>`coalesce(sum(${watches.purchasePriceGbp}), 0)`,
    })
      .from(watches)
      .where(and(isNull(watches.deletedAt), sql`${watches.status} IN ('IN_STOCK', 'RESERVED', 'SALE_AGREED')`)),

    db.select({ count: sql<number>`count(*)` }).from(watches)
      .where(and(
        isNull(watches.deletedAt), isNull(watches.estSaleGbp),
        sql`${watches.status} IN ('IN_STOCK', 'RESERVED', 'SALE_AGREED')`,
      )),

    db.select({ count: sql<number>`count(*)` }).from(watches)
      .where(and(
        isNull(watches.deletedAt), eq(watches.status, 'IN_STOCK'),
        lt(watches.purchaseDate, cutoff),
      )),
  ])

  return {
    held: Number(held[0]?.count ?? 0),
    capitalGbp: Number(held[0]?.capital ?? 0),
    unpriced: Number(unpriced[0]?.count ?? 0),
    ageing: Number(ageing[0]?.count ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Worth knowing
// ---------------------------------------------------------------------------

export type NoticeTone = 'opportunity' | 'attention' | 'housekeeping'

export interface Notice {
  id: string
  tone: NoticeTone
  /** The fact. One sentence, no preamble. */
  headline: string
  /** Why it matters, if that is not obvious from the headline. */
  detail: string | null
  /** What to do about it. Every notice has one. */
  action: { label: string; href: string }
}

/**
 * The single automation surface.
 *
 * V1 had matching, quiet contacts, stale rates and ageing stock each inventing
 * its own notification, which meant four systems nobody had configured and a
 * bell with a permanent unread badge. They all report here instead, in one
 * ordered list, and the order is the point: an opportunity that expires today
 * outranks a housekeeping job that has been outstanding for a month.
 */
export async function worthKnowing(limit = 6): Promise<Notice[]> {
  const notices: Notice[] = []
  const now = Date.now()

  // 1. Demand we can already satisfy. The most expensive mistake in this
  //    business is telling somebody you will look for a watch that is sitting
  //    in the safe, so this leads.
  const matched = await db.select({
    requestId: watchRequests.id,
    customerId: watchRequests.customerId,
    firstName: customers.firstName,
    lastName: customers.lastName,
    model: watchRequests.model,
    brandName: brands.name,
    createdAt: watchRequests.createdAt,
    matches: sql<number>`(
      SELECT count(*) FROM watches w
      WHERE w.deleted_at IS NULL AND w.status = 'IN_STOCK'
        AND (${watchRequests.brandId} IS NULL OR w.brand_id = ${watchRequests.brandId})
        AND (${watchRequests.model} IS NULL OR w.model ILIKE '%' || ${watchRequests.model} || '%')
        AND (${watchRequests.budgetGbp} IS NULL OR w.est_sale_gbp IS NULL
             OR w.est_sale_gbp <= ${watchRequests.budgetGbp})
    )`,
  })
    .from(watchRequests)
    .innerJoin(customers, eq(customers.id, watchRequests.customerId))
    .leftJoin(brands, eq(brands.id, watchRequests.brandId))
    .where(and(
      isNull(watchRequests.deletedAt),
      sql`${watchRequests.status} IN ('OPEN', 'SOURCING', 'MATCHED')`,
    ))
    .orderBy(watchRequests.createdAt)
    .limit(20)

  for (const row of matched.filter((item) => Number(item.matches) > 0)) {
    const waiting = Math.floor((now - row.createdAt.getTime()) / DAY)
    notices.push({
      id: `match-${row.requestId}`,
      tone: 'opportunity',
      headline: `${[row.brandName, row.model].filter(Boolean).join(' ') || 'A watch'} in stock matches what ${row.firstName} ${row.lastName} asked for`,
      detail: waiting > 0
        ? `They have been waiting ${waiting} ${waiting === 1 ? 'day' : 'days'}.`
        : 'Registered today.',
      action: { label: 'Call them', href: `/customers/${row.customerId}` },
    })
  }

  // 2. Offers sent into silence. Work disappearing into somebody else's inbox
  //    is invisible unless something goes looking for it.
  const silent = await db.select({
    id: offers.id,
    dealId: offers.dealId,
    customerId: offers.customerId,
    firstName: customers.firstName,
    lastName: customers.lastName,
    amountGbp: offers.amountGbp,
    createdAt: offers.createdAt,
  })
    .from(offers)
    .leftJoin(customers, eq(customers.id, offers.customerId))
    .where(and(
      eq(offers.status, 'SENT'),
      isNull(offers.respondedAt),
      lt(offers.createdAt, new Date(now - 3 * DAY)),
    ))
    .orderBy(offers.createdAt)
    .limit(5)

  for (const row of silent) {
    const days = Math.floor((now - row.createdAt.getTime()) / DAY)
    notices.push({
      id: `offer-${row.id}`,
      tone: 'attention',
      headline: `£${Math.round(row.amountGbp / 100).toLocaleString('en-GB')} offered to ${row.firstName ?? 'a customer'} ${row.lastName ?? ''}`.trim(),
      detail: `Sent ${days} days ago with no reply.`,
      action: {
        label: 'Chase it',
        href: row.dealId ? `/pipeline/${row.dealId}` : `/customers/${row.customerId}`,
      },
    })
  }

  // 3. Good customers going quiet. A VIP nobody has spoken to in three months
  //    is a VIP who is buying somewhere else.
  const quiet = await db.select({
    id: customers.id,
    firstName: customers.firstName,
    lastName: customers.lastName,
    lastContactedAt: customers.lastContactedAt,
    lifetime: sql<number>`(
      SELECT coalesce(sum(sale_amount_gbp), 0) FROM sales
      WHERE sales.customer_id = ${customers.id}
        AND sales.voided_at IS NULL AND sales.deleted_at IS NULL
    )`,
  })
    .from(customers)
    .where(and(
      isNull(customers.deletedAt),
      eq(customers.status, 'ACTIVE'),
      sql`${customers.tier} IN ('VIP', 'PRIORITY')`,
      or(isNull(customers.lastContactedAt), lt(customers.lastContactedAt, new Date(now - 90 * DAY))),
    ))
    .orderBy(customers.lastContactedAt)
    .limit(4)

  for (const row of quiet) {
    const days = row.lastContactedAt
      ? Math.floor((now - row.lastContactedAt.getTime()) / DAY)
      : null
    notices.push({
      id: `quiet-${row.id}`,
      tone: 'attention',
      headline: `${row.firstName} ${row.lastName} has not heard from us`,
      detail: days === null
        ? 'No contact has ever been logged against them.'
        : `${days} days since the last conversation.`,
      action: { label: 'Open their record', href: `/customers/${row.id}` },
    })
  }

  // 4. Housekeeping, last. Stale rates silently misprice every foreign figure
  //    on every screen, which is a slow, quiet kind of wrong.
  const stale = await db.select({ code: fxRates.code, updatedAt: fxRates.updatedAt })
    .from(fxRates)
    .where(lt(fxRates.updatedAt, new Date(now - 30 * DAY)))

  if (stale.length > 0) {
    notices.push({
      id: 'fx-stale',
      tone: 'housekeeping',
      headline: `${stale.length} exchange ${stale.length === 1 ? 'rate is' : 'rates are'} over a month old`,
      detail: `Every figure shown in ${stale.map((row) => row.code).join(', ')} is being converted at them.`,
      action: { label: 'Update rates', href: '/settings/currencies' },
    })
  }

  const unpriced = await db.select({ count: sql<number>`count(*)` }).from(watches)
    .where(and(
      isNull(watches.deletedAt), isNull(watches.estSaleGbp), eq(watches.status, 'IN_STOCK'),
    ))

  const unpricedCount = Number(unpriced[0]?.count ?? 0)
  if (unpricedCount > 0) {
    notices.push({
      id: 'unpriced',
      tone: 'housekeeping',
      headline: `${unpricedCount} ${unpricedCount === 1 ? 'watch has' : 'watches have'} no asking price`,
      detail: 'They cannot be matched to a want, and they are missing from the margin figures.',
      action: { label: 'Price them', href: '/inventory?unpricedOnly=true' },
    })
  }

  const ORDER: Record<NoticeTone, number> = { opportunity: 0, attention: 1, housekeeping: 2 }
  return notices.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]).slice(0, limit)
}

// ---------------------------------------------------------------------------
// Waiting on them
// ---------------------------------------------------------------------------

export interface WaitingItem {
  id: string
  title: string
  who: string | null
  since: Date
  amountGbp: number | null
  href: string
}

/**
 * Work that is not yours to do and has stopped moving anyway.
 *
 * Generated, never entered. The band exists because the commonest way a deal
 * dies is silently: an offer goes out, nobody replies, and the only record of
 * it is a line in a timeline nobody re-reads. Three sources — offers with no
 * reply after three days, deals that have not moved in a fortnight, and
 * invoices past their terms.
 */
export async function waitingOnThem(limit = 8): Promise<WaitingItem[]> {
  const now = Date.now()

  const [silentOffers, stuckDeals, unpaid] = await Promise.all([
    db.select({
      id: offers.id,
      dealId: offers.dealId,
      customerId: offers.customerId,
      firstName: customers.firstName,
      lastName: customers.lastName,
      amountGbp: offers.amountGbp,
      createdAt: offers.createdAt,
    })
      .from(offers)
      .leftJoin(customers, eq(customers.id, offers.customerId))
      .where(and(
        eq(offers.status, 'SENT'), isNull(offers.respondedAt),
        lt(offers.createdAt, new Date(now - 3 * DAY)),
      ))
      .orderBy(offers.createdAt)
      .limit(limit),

    db.select({
      id: deals.id,
      title: deals.title,
      valueGbp: deals.valueGbp,
      stageChangedAt: deals.stageChangedAt,
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
      .from(deals)
      .leftJoin(customers, eq(customers.id, deals.customerId))
      .where(and(
        isNull(deals.deletedAt), ne(deals.stage, 'WON'), ne(deals.stage, 'LOST'),
        lt(deals.stageChangedAt, new Date(now - 14 * DAY)),
      ))
      .orderBy(deals.stageChangedAt)
      .limit(limit),

    db.select({
      id: sales.id,
      invoiceNo: sales.invoiceNo,
      amountGbp: sales.saleAmountGbp,
      saleDate: sales.saleDate,
      customerName: sales.customerName,
    })
      .from(sales)
      .where(and(
        liveSale(),
        sql`${sales.paymentStatus} IN ('PENDING', 'OVERDUE')`,
        lt(sales.saleDate, new Date(now - 7 * DAY)),
      ))
      .orderBy(sales.saleDate)
      .limit(limit),
  ])

  const items: WaitingItem[] = [
    ...silentOffers.map((row) => ({
      id: `offer-${row.id}`,
      title: 'Offer sent, no reply',
      who: [row.firstName, row.lastName].filter(Boolean).join(' ') || null,
      since: row.createdAt,
      amountGbp: row.amountGbp,
      href: row.dealId ? `/pipeline/${row.dealId}` : `/customers/${row.customerId}`,
    })),
    ...stuckDeals.map((row) => ({
      id: `deal-${row.id}`,
      title: row.title,
      who: [row.firstName, row.lastName].filter(Boolean).join(' ') || null,
      since: row.stageChangedAt,
      amountGbp: row.valueGbp,
      href: `/pipeline/${row.id}`,
    })),
    ...unpaid.map((row) => ({
      id: `sale-${row.id}`,
      title: `${row.invoiceNo} is unpaid`,
      who: row.customerName,
      since: row.saleDate,
      amountGbp: row.amountGbp,
      href: `/sales?invoice=${row.invoiceNo}`,
    })),
  ]

  // Oldest first: the thing that has been waiting longest is the thing most
  // likely to have been forgotten.
  return items.sort((a, b) => a.since.getTime() - b.since.getTime()).slice(0, limit)
}

/** Nothing to do today is a good day, and the screen should be able to say so. */
export async function quietDaySummary() {
  const [movingDeals, held] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(deals)
      .where(and(
        isNull(deals.deletedAt), ne(deals.stage, 'WON'), ne(deals.stage, 'LOST'),
        gte(deals.stageChangedAt, new Date(Date.now() - 7 * DAY)),
      )),
    db.select({ count: sql<number>`count(*)` }).from(watches)
      .where(and(isNull(watches.deletedAt), sql`${watches.status} IN ('IN_STOCK', 'RESERVED', 'SALE_AGREED')`)),
  ])

  return {
    movingDeals: Number(movingDeals[0]?.count ?? 0),
    held: Number(held[0]?.count ?? 0),
  }
}
