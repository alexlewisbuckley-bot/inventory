import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { liveSale } from '../db/predicates'
import {
  activities, brands, customers, customerBrands, deals, offers, sales, suppliers,
  tasks, users, watches, watchRequests, requestEnquiries,
} from '../db/schema'
import type { CustomerQuery, DealQuery, TaskQuery } from '@/lib/validation'
import type { DealStage } from '@/lib/enums'

/**
 * Reads for the CRM.
 *
 * Written to the same shape as the watch repository — a filtered, sorted,
 * paginated `find*` per list plus purpose-built aggregates — so the list
 * screens can reuse the toolbar, pagination and URL-state machinery unchanged.
 */

const live = (table: { deletedAt: unknown }) => isNull(table.deletedAt as never)

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface CustomerListItem {
  id: string
  reference: string
  firstName: string
  lastName: string
  company: string | null
  email: string | null
  phone: string | null
  country: string | null
  tier: string
  customerType: string
  status: string
  leadSource: string
  ownerId: string | null
  ownerName: string | null
  lastContactedAt: Date | null
  createdAt: Date
  /** Denormalised on read: the two numbers that decide who to ring first. */
  purchaseCount: number
  lifetimeValueGbp: number
  openDeals: number
  openRequests: number
}

export interface CustomerListResult {
  items: CustomerListItem[]
  total: number
  page: number
  perPage: number
  pages: number
}

const customerColumns = {
  id: customers.id,
  reference: customers.reference,
  firstName: customers.firstName,
  lastName: customers.lastName,
  company: customers.company,
  email: customers.email,
  phone: customers.phone,
  country: customers.country,
  tier: customers.tier,
  customerType: customers.customerType,
  status: customers.status,
  leadSource: customers.leadSource,
  ownerId: customers.ownerId,
  ownerName: users.name,
  lastContactedAt: customers.lastContactedAt,
  createdAt: customers.createdAt,
  purchaseCount: sql<number>`(
    SELECT count(*) FROM sales
    WHERE sales.customer_id = customers.id AND sales.voided_at IS NULL AND sales.deleted_at IS NULL
  )`,
  lifetimeValueGbp: sql<number>`(
    SELECT coalesce(sum(sales.sale_amount_gbp), 0) FROM sales
    WHERE sales.customer_id = customers.id AND sales.voided_at IS NULL AND sales.deleted_at IS NULL
  )`,
  openDeals: sql<number>`(
    SELECT count(*) FROM deals
    WHERE deals.customer_id = customers.id AND deals.deleted_at IS NULL
      AND deals.stage NOT IN ('WON', 'LOST')
  )`,
  openRequests: sql<number>`(
    SELECT count(*) FROM watch_requests
    WHERE watch_requests.customer_id = customers.id AND watch_requests.deleted_at IS NULL
      AND watch_requests.status IN ('OPEN', 'SOURCING', 'MATCHED')
  )`,
} as const

function customerFilters(query: CustomerQuery): SQL | undefined {
  const clauses: (SQL | undefined)[] = [isNull(customers.deletedAt)]

  if (query.q) {
    const needle = `%${query.q}%`
    clauses.push(or(
      ilike(customers.firstName, needle),
      ilike(customers.lastName, needle),
      ilike(customers.company, needle),
      ilike(customers.email, needle),
      // Punctuation in a typed phone number should not stop it matching one
      // stored as +44 7700 900000.
      sql`regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g') LIKE ${`%${query.q.replace(/\D/g, '')}%`}
          AND ${query.q.replace(/\D/g, '') !== ''}`,
      ilike(customers.reference, needle),
    ))
  }
  if (query.tier?.length) clauses.push(inArray(customers.tier, query.tier))
  if (query.customerType?.length) clauses.push(inArray(customers.customerType, query.customerType))
  if (query.status?.length) clauses.push(inArray(customers.status, query.status))
  if (query.ownerId?.length) clauses.push(inArray(customers.ownerId, query.ownerId))
  if (query.leadSource?.length) clauses.push(inArray(customers.leadSource, query.leadSource))

  const present = clauses.filter(Boolean) as SQL[]
  return present.length > 0 ? and(...present) : undefined
}

export async function findCustomers(query: CustomerQuery): Promise<CustomerListResult> {
  const where = customerFilters(query)
  const direction = query.dir === 'asc' ? asc : desc

  const order = query.sort === 'name' ? [direction(customers.lastName), direction(customers.firstName)]
    : query.sort === 'value' ? [direction(customerColumns.lifetimeValueGbp)]
    : query.sort === 'lastContact' ? [direction(customers.lastContactedAt)]
    : [direction(customers.createdAt)]

  const [rows, counted] = await Promise.all([
    db.select(customerColumns).from(customers)
      .leftJoin(users, eq(users.id, customers.ownerId))
      .where(where)
      .orderBy(...order)
      .limit(query.perPage)
      .offset((query.page - 1) * query.perPage),
    db.select({ value: sql<number>`count(*)` }).from(customers).where(where),
  ])

  const total = Number(counted[0]?.value ?? 0)
  return {
    items: rows.map((row) => ({
      ...row,
      purchaseCount: Number(row.purchaseCount),
      lifetimeValueGbp: Number(row.lifetimeValueGbp),
      openDeals: Number(row.openDeals),
      openRequests: Number(row.openRequests),
    })),
    total,
    page: query.page,
    perPage: query.perPage,
    pages: Math.max(1, Math.ceil(total / query.perPage)),
  }
}

export async function getCustomer(id: string) {
  const [row] = await db
    .select({ customer: customers, ownerName: users.name })
    .from(customers)
    .leftJoin(users, eq(users.id, customers.ownerId))
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
    .limit(1)
  return row ?? null
}

/** Everything the customer record needs, in one round trip. */
export async function getCustomerContext(id: string) {
  const [favouriteBrands, purchases, openDeals, requests, openTasks, recentOffers] = await Promise.all([
    db.select({ id: brands.id, name: brands.name })
      .from(customerBrands)
      .innerJoin(brands, eq(brands.id, customerBrands.brandId))
      .where(eq(customerBrands.customerId, id))
      .orderBy(asc(brands.name)),

    db.select({
      saleId: sales.id,
      invoiceNo: sales.invoiceNo,
      saleDate: sales.saleDate,
      amountGbp: sales.saleAmountGbp,
      profitGbp: sales.profitGbp,
      paymentStatus: sales.paymentStatus,
      deliveryStatus: sales.deliveryStatus,
      watchId: watches.id,
      stockNo: watches.stockNo,
      model: watches.model,
      brandName: brands.name,
    })
      .from(sales)
      .innerJoin(watches, eq(watches.id, sales.watchId))
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(and(eq(sales.customerId, id), liveSale()))
      .orderBy(desc(sales.saleDate)),

    db.select({
      id: deals.id,
      reference: deals.reference,
      title: deals.title,
      stage: deals.stage,
      valueGbp: deals.valueGbp,
      probability: deals.probability,
      expectedClose: deals.expectedClose,
      ownerName: users.name,
      stockNo: watches.stockNo,
    })
      .from(deals)
      .leftJoin(users, eq(users.id, deals.ownerId))
      .leftJoin(watches, eq(watches.id, deals.watchId))
      .where(and(eq(deals.customerId, id), isNull(deals.deletedAt)))
      .orderBy(desc(deals.updatedAt)),

    db.select({
      id: watchRequests.id,
      brandName: brands.name,
      model: watchRequests.model,
      referenceNo: watchRequests.referenceNo,
      budgetGbp: watchRequests.budgetGbp,
      priority: watchRequests.priority,
      status: watchRequests.status,
      targetDate: watchRequests.targetDate,
    })
      .from(watchRequests)
      .leftJoin(brands, eq(brands.id, watchRequests.brandId))
      .where(and(eq(watchRequests.customerId, id), isNull(watchRequests.deletedAt)))
      .orderBy(desc(watchRequests.createdAt)),

    db.select({
      id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, kind: tasks.kind,
      priority: tasks.priority, status: tasks.status, assigneeName: users.name,
    })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(eq(tasks.customerId, id), eq(tasks.status, 'OPEN'), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.dueAt)),

    db.select({
      id: offers.id, amountGbp: offers.amountGbp, status: offers.status,
      createdAt: offers.createdAt, stockNo: watches.stockNo, model: watches.model,
    })
      .from(offers)
      .leftJoin(watches, eq(watches.id, offers.watchId))
      .where(eq(offers.customerId, id))
      .orderBy(desc(offers.createdAt))
      .limit(10),
  ])

  return { favouriteBrands, purchases, openDeals, requests, openTasks, recentOffers }
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  id: string
  type: string
  direction: string
  subject: string | null
  body: string | null
  occurredAt: Date
  durationMin: number | null
  isSystem: boolean
  actorName: string | null
  customerId: string | null
  watchId: string | null
  dealId: string | null
}

/** The activity feed for one entity, newest first. */
export async function timelineFor(
  scope: { customerId?: string; supplierId?: string; watchId?: string; dealId?: string; requestId?: string },
  limit = 50,
): Promise<TimelineEntry[]> {
  const clauses: SQL[] = [isNull(activities.deletedAt)]
  if (scope.customerId) clauses.push(eq(activities.customerId, scope.customerId))
  if (scope.supplierId) clauses.push(eq(activities.supplierId, scope.supplierId))
  if (scope.watchId) clauses.push(eq(activities.watchId, scope.watchId))
  if (scope.dealId) clauses.push(eq(activities.dealId, scope.dealId))
  if (scope.requestId) clauses.push(eq(activities.requestId, scope.requestId))

  return db.select({
    id: activities.id,
    type: activities.type,
    direction: activities.direction,
    subject: activities.subject,
    body: activities.body,
    occurredAt: activities.occurredAt,
    durationMin: activities.durationMin,
    isSystem: activities.isSystem,
    actorName: users.name,
    customerId: activities.customerId,
    watchId: activities.watchId,
    dealId: activities.dealId,
  })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(and(...clauses))
    .orderBy(desc(activities.occurredAt))
    .limit(limit)
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export interface DealCard {
  id: string
  reference: string
  title: string
  stage: DealStage
  valueGbp: number | null
  probability: number
  expectedClose: string | null
  sortOrder: number
  stageChangedAt: Date
  customerId: string | null
  customerName: string | null
  customerTier: string | null
  watchId: string | null
  stockNo: number | null
  watchLabel: string | null
  ownerId: string | null
  ownerName: string | null
  ownerInitials: string | null
  openTasks: number
  overdueTasks: number
}

const dealCardColumns = {
  id: deals.id,
  reference: deals.reference,
  title: deals.title,
  stage: deals.stage,
  valueGbp: deals.valueGbp,
  probability: deals.probability,
  expectedClose: deals.expectedClose,
  sortOrder: deals.sortOrder,
  stageChangedAt: deals.stageChangedAt,
  customerId: deals.customerId,
  customerName: sql<string | null>`nullif(trim(coalesce(${customers.firstName}, '') || ' ' || coalesce(${customers.lastName}, '')), '')`,
  customerTier: customers.tier,
  watchId: deals.watchId,
  stockNo: watches.stockNo,
  watchLabel: sql<string | null>`nullif(trim(coalesce(${brands.name}, '') || ' ' || coalesce(${watches.model}, '')), '')`,
  ownerId: deals.ownerId,
  ownerName: users.name,
  ownerInitials: users.initials,
  openTasks: sql<number>`(
    SELECT count(*) FROM tasks
    WHERE tasks.deal_id = deals.id AND tasks.status = 'OPEN' AND tasks.deleted_at IS NULL
  )`,
  overdueTasks: sql<number>`(
    SELECT count(*) FROM tasks
    WHERE tasks.deal_id = deals.id AND tasks.status = 'OPEN' AND tasks.deleted_at IS NULL
      AND tasks.due_at < now()
  )`,
} as const

function dealFilters(query: DealQuery): SQL | undefined {
  const clauses: SQL[] = [isNull(deals.deletedAt)]
  if (query.q) {
    const needle = `%${query.q}%`
    const match = or(
      ilike(deals.title, needle),
      ilike(deals.reference, needle),
      ilike(customers.lastName, needle),
      ilike(customers.firstName, needle),
      ilike(watches.stockNo, needle),
      ilike(watches.model, needle),
    )
    if (match) clauses.push(match)
  }
  if (query.ownerId?.length) clauses.push(inArray(deals.ownerId, query.ownerId))
  if (query.stage?.length) clauses.push(inArray(deals.stage, query.stage))
  if (query.openOnly) {
    clauses.push(ne(deals.stage, 'WON'))
    clauses.push(ne(deals.stage, 'LOST'))
  }
  return clauses.length > 0 ? and(...clauses) : undefined
}

/** Every card on the board. The board is small by nature; it is not paginated. */
export async function findDeals(query: DealQuery): Promise<DealCard[]> {
  const rows = await db.select(dealCardColumns)
    .from(deals)
    .leftJoin(customers, eq(customers.id, deals.customerId))
    .leftJoin(watches, eq(watches.id, deals.watchId))
    .leftJoin(brands, eq(brands.id, watches.brandId))
    .leftJoin(users, eq(users.id, deals.ownerId))
    .where(dealFilters(query))
    .orderBy(asc(deals.sortOrder), desc(deals.updatedAt))
    .limit(500)

  return rows.map((row) => ({
    ...row,
    stage: row.stage as DealStage,
    openTasks: Number(row.openTasks),
    overdueTasks: Number(row.overdueTasks),
  }))
}

export async function getDeal(id: string) {
  const [row] = await db.select({
    deal: deals,
    customerName: sql<string | null>`nullif(trim(coalesce(${customers.firstName}, '') || ' ' || coalesce(${customers.lastName}, '')), '')`,
    customerEmail: customers.email,
    customerPhone: customers.phone,
    ownerName: users.name,
    stockNo: watches.stockNo,
    watchModel: watches.model,
    watchCostGbp: watches.purchasePriceGbp,
  })
    .from(deals)
    .leftJoin(customers, eq(customers.id, deals.customerId))
    .leftJoin(users, eq(users.id, deals.ownerId))
    .leftJoin(watches, eq(watches.id, deals.watchId))
    .where(and(eq(deals.id, id), isNull(deals.deletedAt)))
    .limit(1)
  return row ?? null
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface TaskRow {
  id: string
  title: string
  notes: string | null
  kind: string
  priority: string
  status: string
  dueAt: Date | null
  assigneeId: string | null
  assigneeName: string | null
  customerId: string | null
  customerName: string | null
  dealId: string | null
  dealTitle: string | null
  watchId: string | null
  stockNo: number | null
}

export async function findTasks(query: TaskQuery): Promise<TaskRow[]> {
  const clauses: SQL[] = [isNull(tasks.deletedAt)]
  if (query.status?.length) clauses.push(inArray(tasks.status, query.status))
  if (query.assigneeId?.length) clauses.push(inArray(tasks.assigneeId, query.assigneeId))
  if (query.dueBefore) clauses.push(lte(tasks.dueAt, query.dueBefore))
  if (query.dueAfter) clauses.push(gte(tasks.dueAt, query.dueAfter))
  if (query.customerId) clauses.push(eq(tasks.customerId, query.customerId))
  if (query.dealId) clauses.push(eq(tasks.dealId, query.dealId))

  return db.select({
    id: tasks.id,
    title: tasks.title,
    notes: tasks.notes,
    kind: tasks.kind,
    priority: tasks.priority,
    status: tasks.status,
    dueAt: tasks.dueAt,
    assigneeId: tasks.assigneeId,
    assigneeName: users.name,
    customerId: tasks.customerId,
    customerName: sql<string | null>`nullif(trim(coalesce(${customers.firstName}, '') || ' ' || coalesce(${customers.lastName}, '')), '')`,
    dealId: tasks.dealId,
    dealTitle: deals.title,
    watchId: tasks.watchId,
    stockNo: watches.stockNo,
  })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(customers, eq(customers.id, tasks.customerId))
    .leftJoin(deals, eq(deals.id, tasks.dealId))
    .leftJoin(watches, eq(watches.id, tasks.watchId))
    .where(and(...clauses))
    // Undated tasks last: a task with no date is a wish, not a commitment.
    .orderBy(sql`${tasks.dueAt} ASC NULLS LAST`, desc(tasks.priority))
    .limit(300)
}

// ---------------------------------------------------------------------------
// Watch requests
// ---------------------------------------------------------------------------

export async function findRequests(options: { status?: string[]; customerId?: string } = {}) {
  const clauses: SQL[] = [isNull(watchRequests.deletedAt)]
  if (options.status?.length) clauses.push(inArray(watchRequests.status, options.status as never))
  if (options.customerId) clauses.push(eq(watchRequests.customerId, options.customerId))

  return db.select({
    id: watchRequests.id,
    customerId: watchRequests.customerId,
    customerName: sql<string>`trim(coalesce(${customers.firstName}, '') || ' ' || coalesce(${customers.lastName}, ''))`,
    customerTier: customers.tier,
    brandId: watchRequests.brandId,
    brandName: brands.name,
    model: watchRequests.model,
    referenceNo: watchRequests.referenceNo,
    dial: watchRequests.dial,
    bracelet: watchRequests.bracelet,
    condition: watchRequests.condition,
    budgetGbp: watchRequests.budgetGbp,
    targetDate: watchRequests.targetDate,
    priority: watchRequests.priority,
    status: watchRequests.status,
    notes: watchRequests.notes,
    ownerName: users.name,
    createdAt: watchRequests.createdAt,
    enquiries: sql<number>`(
      SELECT count(*) FROM request_enquiries WHERE request_enquiries.request_id = watch_requests.id
    )`,
  })
    .from(watchRequests)
    .innerJoin(customers, eq(customers.id, watchRequests.customerId))
    .leftJoin(brands, eq(brands.id, watchRequests.brandId))
    .leftJoin(users, eq(users.id, watchRequests.ownerId))
    .where(and(...clauses))
    .orderBy(desc(watchRequests.createdAt))
    .limit(200)
}

export async function enquiriesFor(requestId: string) {
  return db.select({
    id: requestEnquiries.id,
    supplierId: requestEnquiries.supplierId,
    supplierName: suppliers.name,
    status: requestEnquiries.status,
    quotedGbp: requestEnquiries.quotedGbp,
    notes: requestEnquiries.notes,
    createdAt: requestEnquiries.createdAt,
  })
    .from(requestEnquiries)
    .leftJoin(suppliers, eq(suppliers.id, requestEnquiries.supplierId))
    .where(eq(requestEnquiries.requestId, requestId))
    .orderBy(desc(requestEnquiries.createdAt))
}

// ---------------------------------------------------------------------------
// The other direction: CRM context for a watch
// ---------------------------------------------------------------------------

/**
 * Who wants this watch.
 *
 * The question asked while holding it. Interest is drawn from three places —
 * an open deal against it, an offer already made, and a standing request whose
 * criteria it satisfies — because a customer can be interested without anyone
 * having created a deal yet.
 */
export async function interestInWatch(watchId: string) {
  const [watch] = await db.select({
    id: watches.id, brandId: watches.brandId, model: watches.model,
    estSaleGbp: watches.estSaleGbp, purchasePriceGbp: watches.purchasePriceGbp,
  }).from(watches).where(eq(watches.id, watchId)).limit(1)

  const [dealRows, offerRows, matchingRequests] = await Promise.all([
    db.select({
      id: deals.id, reference: deals.reference, title: deals.title, stage: deals.stage,
      valueGbp: deals.valueGbp, customerId: deals.customerId,
      customerName: sql<string | null>`nullif(trim(coalesce(${customers.firstName}, '') || ' ' || coalesce(${customers.lastName}, '')), '')`,
      ownerName: users.name,
    })
      .from(deals)
      .leftJoin(customers, eq(customers.id, deals.customerId))
      .leftJoin(users, eq(users.id, deals.ownerId))
      .where(and(eq(deals.watchId, watchId), isNull(deals.deletedAt)))
      .orderBy(desc(deals.updatedAt)),

    db.select({
      id: offers.id, amountGbp: offers.amountGbp, status: offers.status, createdAt: offers.createdAt,
      customerId: offers.customerId,
      customerName: sql<string | null>`nullif(trim(coalesce(${customers.firstName}, '') || ' ' || coalesce(${customers.lastName}, '')), '')`,
    })
      .from(offers)
      .leftJoin(customers, eq(customers.id, offers.customerId))
      .where(eq(offers.watchId, watchId))
      .orderBy(desc(offers.createdAt)),

    watch
      ? db.select({
        id: watchRequests.id,
        customerId: watchRequests.customerId,
        customerName: sql<string>`trim(coalesce(${customers.firstName}, '') || ' ' || coalesce(${customers.lastName}, ''))`,
        customerTier: customers.tier,
        budgetGbp: watchRequests.budgetGbp,
        priority: watchRequests.priority,
        referenceNo: watchRequests.referenceNo,
      })
        .from(watchRequests)
        .innerJoin(customers, eq(customers.id, watchRequests.customerId))
        .where(and(
          isNull(watchRequests.deletedAt),
          inArray(watchRequests.status, ['OPEN', 'SOURCING', 'MATCHED']),
          or(
            eq(watchRequests.brandId, watch.brandId),
            watch.model ? ilike(watchRequests.referenceNo, watch.model) : undefined,
          )!,
        ))
        .orderBy(desc(watchRequests.priority))
      : Promise.resolve([]),
  ])

  return { deals: dealRows, offers: offerRows, matchingRequests }
}

/** Everyone who has ever owned this watch through us. */
export async function ownershipHistory(watchId: string) {
  return db.select({
    saleId: sales.id,
    invoiceNo: sales.invoiceNo,
    saleDate: sales.saleDate,
    amountGbp: sales.saleAmountGbp,
    profitGbp: sales.profitGbp,
    customerId: sales.customerId,
    customerName: sql<string | null>`coalesce(
      nullif(trim(coalesce(${customers.firstName}, '') || ' ' || coalesce(${customers.lastName}, '')), ''),
      ${sales.customerName}
    )`,
  })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    // A voided sale is a sale that did not happen, so the buyer never owned
    // the watch and does not belong in its ownership history.
    .where(and(eq(sales.watchId, watchId), liveSale()))
    .orderBy(desc(sales.saleDate))
}

/**
 * The customer list as the sell form needs it.
 *
 * Small and flat on purpose: the picker is a search box over a few hundred
 * names, and passing them with the page beats a round trip on every keystroke.
 */
export async function customerOptions() {
  return db.select({
    id: customers.id,
    name: sql<string>`trim(${customers.firstName} || ' ' || ${customers.lastName})`,
    company: customers.company,
    email: customers.email,
    phone: customers.phone,
    country: customers.country,
    customerType: customers.customerType,
  })
    .from(customers)
    .where(isNull(customers.deletedAt))
    .orderBy(asc(customers.lastName), asc(customers.firstName))
    .limit(1000)
}

export interface WatchDealOption {
  id: string
  watchId: string | null
  title: string
  stage: string
  valueGbp: number | null
  customerId: string | null
}

/** Open deals keyed by the watch they are against, for the sell form. */
export async function openDealsByWatch(): Promise<Record<string, WatchDealOption[]>> {
  const rows = await db.select({
    id: deals.id,
    watchId: deals.watchId,
    title: deals.title,
    stage: deals.stage,
    valueGbp: deals.valueGbp,
    customerId: deals.customerId,
  })
    .from(deals)
    .where(and(
      isNull(deals.deletedAt),
      ne(deals.stage, 'WON'),
      ne(deals.stage, 'LOST'),
      sql`${deals.watchId} IS NOT NULL`,
    ))

  const byWatch = new Map<string, WatchDealOption[]>()
  for (const row of rows) {
    if (!row.watchId) continue
    const list = byWatch.get(row.watchId) ?? []
    list.push(row)
    byWatch.set(row.watchId, list)
  }
  return Object.fromEntries(byWatch)
}

/**
 * The two lines of business, side by side.
 *
 * The reason the distinction is worth carrying at all: trade moves volume at
 * thin margins and retail moves fewer at fat ones, and a single blended margin
 * describes neither. Sales with no customer attached are reported separately
 * rather than being quietly folded into retail.
 */
export async function tradeVsRetail() {
  const rows = await db.select({
    segment: sql<string>`coalesce(${customers.customerType}, 'UNATTRIBUTED')`,
    sales: sql<number>`count(*)`,
    revenueGbp: sql<number>`coalesce(sum(${sales.saleAmountGbp}), 0)`,
    profitGbp: sql<number>`coalesce(sum(${sales.profitGbp}), 0)`,
  })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(liveSale())
    .groupBy(sql`coalesce(${customers.customerType}, 'UNATTRIBUTED')`)

  return rows.map((row) => ({
    segment: row.segment,
    sales: Number(row.sales),
    revenueGbp: Number(row.revenueGbp),
    profitGbp: Number(row.profitGbp),
    marginPct: Number(row.revenueGbp) > 0
      ? (Number(row.profitGbp) / Number(row.revenueGbp)) * 100
      : null,
  }))
}
