import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { buybackCharges, buybackItems, buybacks, customers, salesPeople } from '../db/schema'
import { newId } from '@/lib/ids'
import { addMonths } from '@/lib/checks'
import { BASE_CURRENCY, type BuybackChargeKind, type BuybackStatus, type CurrencyCode } from '@/lib/enums'
import { RATE_SCALE, type RateTable } from '@/lib/currency'
import { getRateTable } from './fx-service'
import { recordAudit } from './audit'
import { NotFoundError, ValidationError } from '@/lib/errors'
import type { SessionUser } from '../auth/session'

/**
 * Buy-backs: money lent against watches we hold as security.
 *
 * The customer keeps ownership. We advance a sum, hold their watches, and
 * earn interest every month until they redeem. Three things follow from
 * that, and they are the whole design:
 *
 * The principal is not a cost. It is capital out that we expect back, so
 * it never reaches profit — booking it as an expense would read as a loss
 * every time we wrote a loan, and booking the redemption as income would
 * read as a windfall when the money came back. Only the interest and the
 * fees are earnings.
 *
 * The watches are not stock. They are somebody else's property, so they
 * stay out of inventory, out of capital deployed and off the website until
 * a default makes them ours.
 *
 * And the interest is a series, not a total. "They have paid four of six
 * months" is the question this exists to answer, and one running figure
 * cannot answer it.
 */

/* ================= the arithmetic ================= */

/**
 * What one month's interest comes to.
 *
 * Rounded to the minor unit once, here, so the figure charged and the
 * figure reported are the same number rather than two roundings of one
 * calculation that drift apart by a fil.
 */
export function monthlyFor(principalBase: number, rateBps: number): number {
  return Math.round((principalBase * rateBps) / 10_000)
}

/** The rate implied by an amount somebody typed, in basis points. */
export function rateFor(principalBase: number, monthlyBase: number): number {
  if (principalBase <= 0) return 0
  return Math.round((monthlyBase * 10_000) / principalBase)
}

/**
 * How many whole months of interest a loan has earned.
 *
 * Interest is charged in arrears: a loan written on the 3rd earns its
 * first month on the 3rd of the following month, not on the day it is
 * written. Charging on day one would bill a customer who redeemed the same
 * week for a month they never had.
 *
 * Counted in whole months rather than by dividing days, because a month is
 * what was agreed and February is not a short month to somebody paying by
 * the month.
 */
export function periodsElapsed(startedOn: Date, now: Date, closedOn?: Date | null): number {
  // Interest stops the day the loan closes. A loan redeemed in March does
  // not keep earning through April because nobody opened the screen.
  const end = closedOn && closedOn < now ? closedOn : now
  if (end <= startedOn) return 0

  let months = (end.getUTCFullYear() - startedOn.getUTCFullYear()) * 12
    + (end.getUTCMonth() - startedOn.getUTCMonth())
  // The last month is only earned once its anniversary has actually passed.
  const anniversary = addMonths(startedOn, months)
  if (anniversary && anniversary > end) months -= 1
  return Math.max(0, months)
}

/** When the nth month of interest falls due. */
export function dueDateFor(startedOn: Date, period: number): Date {
  return addMonths(startedOn, period) ?? startedOn
}

/** An amount as agreed, converted to the base the reports add up. */
export function inBase(amount: number, currency: CurrencyCode, rates: RateTable): {
  base: number
  fxRate: number
} {
  const rate = currency === BASE_CURRENCY ? RATE_SCALE : rates[currency] ?? RATE_SCALE
  return {
    base: currency === BASE_CURRENCY ? amount : Math.round((amount * RATE_SCALE) / rate),
    fxRate: rate,
  }
}

/* ================= writing one down ================= */

export interface BuybackItemInput {
  description: string
  brand?: string | null
  model?: string | null
  serial?: string | null
  year?: number | null
  /** What this one was valued at, in the loan's currency, minor units. */
  agreedAmount?: number | null
}

export interface BuybackInput {
  reference?: string | null
  customerId?: string | null
  customerName: string
  principalAmount: number
  principalCurrency: CurrencyCode
  /** The monthly rate in basis points: 250 is two and a half percent. */
  rateBps: number
  startedOn: Date
  dueOn?: Date | null
  soldById?: string | null
  notes?: string | null
  items: BuybackItemInput[]
}

export async function recordBuyback(input: BuybackInput, actor: SessionUser): Promise<string> {
  if (input.principalAmount <= 0) {
    throw new ValidationError('The amount advanced must be more than nothing.', {
      principalAmount: 'Enter what you lent.',
    })
  }
  if (input.items.length === 0) {
    throw new ValidationError('A buy-back is secured on at least one watch.', {
      items: 'Add what is securing it.',
    })
  }

  const rates = await getRateTable()
  const { base: principalBase, fxRate } = inBase(input.principalAmount, input.principalCurrency, rates)

  return withTransaction(async () => {
    const id = newId('bbk')
    await db.insert(buybacks).values({
      id,
      reference: input.reference?.trim() || null,
      customerId: input.customerId || null,
      customerName: input.customerName.trim(),
      principalAmount: input.principalAmount,
      principalCurrency: input.principalCurrency,
      principalFxRate: fxRate,
      principalBase,
      rateBps: input.rateBps,
      monthlyBase: monthlyFor(principalBase, input.rateBps),
      startedOn: input.startedOn,
      dueOn: input.dueOn ?? null,
      soldById: input.soldById || null,
      notes: input.notes?.trim() || null,
      recordedById: actor.id,
    })

    for (const item of input.items) {
      const agreed = item.agreedAmount
        ? inBase(item.agreedAmount, input.principalCurrency, rates).base
        : null
      await db.insert(buybackItems).values({
        id: newId('bbi'),
        buybackId: id,
        description: item.description.trim(),
        brand: item.brand?.trim() || null,
        model: item.model?.trim() || null,
        serial: item.serial?.trim() || null,
        year: item.year ?? null,
        agreedBase: agreed,
      })
    }

    await recordAudit({
      entityType: 'Buyback', entityId: id, action: 'CREATE', actorId: actor.id,
      summary: `${actor.name} wrote a buy-back for ${input.customerName}`,
    })
    return id
  })
}

/* ================= the interest that builds up ================= */

/**
 * Add any months of interest that have fallen due and are not yet raised.
 *
 * Run on read rather than on a schedule. A cron that has not fired since
 * Friday leaves the screen lying about what is owed, and the one moment
 * somebody needs the figure to be right is the moment they are looking at
 * it. Inserting what is missing is idempotent — the unique index on
 * (buyback_id, period_index) means two requests racing cannot bill the
 * same month twice, and the loser is refused by the database rather than
 * by a check that raced.
 *
 * Returns how many charges it raised, which is zero almost every time.
 */
export async function accrueInterest(buybackId: string, now: Date = new Date()): Promise<number> {
  const rows = await db.select().from(buybacks)
    .where(and(eq(buybacks.id, buybackId), isNull(buybacks.deletedAt))).limit(1)
  const loan = rows[0]
  if (!loan) return 0

  const periods = periodsElapsed(loan.startedOn, now, loan.closedOn)
  if (periods <= 0) return 0

  const existing = await db.select({ periodIndex: buybackCharges.periodIndex })
    .from(buybackCharges)
    .where(and(
      eq(buybackCharges.buybackId, buybackId),
      eq(buybackCharges.kind, 'INTEREST'),
      isNull(buybackCharges.voidedAt),
    ))
  const raised = new Set(existing.map((row) => row.periodIndex))

  let added = 0
  for (let period = 1; period <= periods; period += 1) {
    if (raised.has(period)) continue
    try {
      await db.insert(buybackCharges).values({
        id: newId('bbc'),
        buybackId,
        kind: 'INTEREST',
        periodIndex: period,
        dueOn: dueDateFor(loan.startedOn, period),
        // The figures as they stood when the month was earned. A rate
        // changed later moves future months, never ones already billed.
        amount: monthlyFor(loan.principalAmount, loan.rateBps),
        currency: loan.principalCurrency,
        fxRate: loan.principalFxRate,
        amountBase: loan.monthlyBase,
      })
      added += 1
    } catch (error) {
      // The unique index refused it: another request raised this month
      // between the read above and this insert. That is the index doing
      // its job, not a failure to report.
      if (!isDuplicatePeriod(error)) throw error
    }
  }
  return added
}

function isDuplicatePeriod(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { code?: string }).code === '23505'
}

/** Accrue across every open loan, so a list is right the moment it loads. */
export async function accrueAllOpen(now: Date = new Date()): Promise<number> {
  const open = await db.select({ id: buybacks.id }).from(buybacks)
    .where(and(eq(buybacks.status, 'OPEN'), isNull(buybacks.deletedAt)))
  let added = 0
  for (const loan of open) added += await accrueInterest(loan.id, now)
  return added
}

/**
 * Charge an extension fee.
 *
 * Its own charge rather than an adjustment to the interest: an extension is
 * a separate thing that was agreed on a day, and rolling it into a month's
 * interest makes both figures unexplainable to the customer holding the
 * paperwork.
 */
export async function addExtensionFee(
  input: { buybackId: string; amount: number; currency: CurrencyCode; dueOn: Date; newDueOn?: Date | null; notes?: string | null },
  actor: SessionUser,
): Promise<string> {
  if (input.amount <= 0) {
    throw new ValidationError('An extension fee has to be more than nothing.', {
      amount: 'Enter the fee.',
    })
  }
  const rates = await getRateTable()
  const { base, fxRate } = inBase(input.amount, input.currency, rates)

  return withTransaction(async () => {
    const rows = await db.select().from(buybacks)
      .where(and(eq(buybacks.id, input.buybackId), isNull(buybacks.deletedAt))).limit(1)
    const loan = rows[0]
    if (!loan) throw new NotFoundError('Buy-back')

    const id = newId('bbc')
    await db.insert(buybackCharges).values({
      id,
      buybackId: input.buybackId,
      kind: 'EXTENSION',
      periodIndex: null,
      dueOn: input.dueOn,
      amount: input.amount,
      currency: input.currency,
      fxRate,
      amountBase: base,
      notes: input.notes?.trim() || null,
    })

    // An extension that moves the redemption date says so on the loan, or
    // the screen goes on showing it overdue while the fee for extending it
    // sits right beneath.
    if (input.newDueOn) {
      await db.update(buybacks)
        .set({ dueOn: input.newDueOn, updatedAt: new Date() })
        .where(eq(buybacks.id, input.buybackId))
    }

    await recordAudit({
      entityType: 'Buyback', entityId: input.buybackId, action: 'UPDATE', actorId: actor.id,
      summary: `${actor.name} charged an extension fee on ${loan.customerName}'s buy-back`,
    })
    return id
  })
}

/** The money for one charge is in. */
export async function markChargePaid(chargeId: string, actor: SessionUser): Promise<void> {
  const updated = await db.update(buybackCharges)
    .set({ paymentStatus: 'PAID', paidOn: new Date(), updatedAt: new Date() })
    .where(and(eq(buybackCharges.id, chargeId), isNull(buybackCharges.voidedAt)))
    .returning({ id: buybackCharges.id, buybackId: buybackCharges.buybackId })
  if (!updated[0]) throw new NotFoundError('Charge')

  await recordAudit({
    entityType: 'Buyback', entityId: updated[0].buybackId, action: 'UPDATE', actorId: actor.id,
    summary: `${actor.name} marked a buy-back charge paid`,
  })
}

/**
 * Void a charge.
 *
 * Voided rather than deleted, as a sale is: a month billed and then waived
 * is a fact, and the reports exclude it while the correction stays
 * explicable. Voiding also frees the month, so accrual will raise it again
 * if it genuinely was owed — which is what makes waiving a month and
 * re-billing it possible without touching the database by hand.
 */
export async function voidCharge(chargeId: string, reason: string, actor: SessionUser): Promise<void> {
  const updated = await db.update(buybackCharges)
    .set({ voidedAt: new Date(), voidedById: actor.id, voidReason: reason.trim() || null, updatedAt: new Date() })
    .where(and(eq(buybackCharges.id, chargeId), isNull(buybackCharges.voidedAt)))
    .returning({ id: buybackCharges.id, buybackId: buybackCharges.buybackId })
  if (!updated[0]) throw new NotFoundError('Charge')

  await recordAudit({
    entityType: 'Buyback', entityId: updated[0].buybackId, action: 'UPDATE', actorId: actor.id,
    summary: `${actor.name} voided a buy-back charge: ${reason.trim() || 'no reason given'}`,
  })
}

/* ================= closing one ================= */

/**
 * They paid the principal back and took their watches.
 *
 * The principal leaving again is not income, the same way advancing it was
 * not a cost: it is the same money coming home. Only the interest and the
 * fees were ever earnings, and they are already recorded.
 */
export async function redeemBuyback(id: string, actor: SessionUser, when: Date = new Date()): Promise<void> {
  return withTransaction(async () => {
    const rows = await db.select().from(buybacks)
      .where(and(eq(buybacks.id, id), isNull(buybacks.deletedAt))).limit(1)
    const loan = rows[0]
    if (!loan) throw new NotFoundError('Buy-back')
    if (loan.status !== 'OPEN') {
      throw new ValidationError('This buy-back is already closed.')
    }

    // Everything earned up to today, before the clock stops.
    await accrueInterest(id, when)

    await db.update(buybacks)
      .set({ status: 'REDEEMED', closedOn: when, updatedAt: new Date() })
      .where(eq(buybacks.id, id))

    await recordAudit({
      entityType: 'Buyback', entityId: id, action: 'UPDATE', actorId: actor.id,
      summary: `${actor.name} redeemed ${loan.customerName}'s buy-back`,
    })
  })
}

/**
 * They did not redeem, so the watches are ours.
 *
 * Each one becomes a stock record costing its share of what we lent, which
 * is exactly what it cost us: the loan was the price of acquiring it, and
 * nothing else changed hands. From that moment it is ordinary stock — it
 * ages, it reaches the website, and the margin it eventually sells at is
 * measured against the money that bought it.
 *
 * The share is each item's own valuation where one was recorded, because
 * two watches securing one loan are rarely worth the same. Where none
 * were, the principal is split evenly and the rounding remainder lands on
 * the first, so the costs always add up to exactly what was lent rather
 * than to a fil more or less.
 */
export async function defaultBuyback(id: string, actor: SessionUser, when: Date = new Date()): Promise<string[]> {
  const { nextStockNo } = await import('../repositories/watch-repository')
  const { createOrFindBrand, createOrFindSupplier } = await import('./reference-service')
  const { watches, locations, userPreferences } = await import('../db/schema')

  const rows = await db.select().from(buybacks)
    .where(and(eq(buybacks.id, id), isNull(buybacks.deletedAt))).limit(1)
  const loan = rows[0]
  if (!loan) throw new NotFoundError('Buy-back')
  if (loan.status !== 'OPEN') throw new ValidationError('This buy-back is already closed.')

  const items = await db.select().from(buybackItems)
    .where(eq(buybackItems.buybackId, id)).orderBy(asc(buybackItems.createdAt))
  if (items.length === 0) throw new ValidationError('There is nothing securing this buy-back.')

  // Where the watches go. The same answer the intake form gives: the
  // person's own default location, or the first one on the list.
  const preference = await db.select({ locationId: userPreferences.defaultLocationId })
    .from(userPreferences).where(eq(userPreferences.userId, actor.id)).limit(1)
  let locationId = preference[0]?.locationId ?? null
  if (!locationId) {
    const first = await db.select({ id: locations.id }).from(locations)
      .where(isNull(locations.deletedAt)).orderBy(asc(locations.sortOrder)).limit(1)
    locationId = first[0]?.id ?? null
  }
  if (!locationId) {
    throw new ValidationError('Add a location before taking watches into stock.')
  }

  // Where they came from, on the stock record. The customer who pledged
  // them is the supplier of that watch in every sense the book means it.
  const supplier = await createOrFindSupplier(loan.customerName, actor)
  const costs = shareOut(loan.principalBase, items.map((item) => item.agreedBase ?? null))

  return withTransaction(async () => {
    const created: string[] = []
    for (const [index, item] of items.entries()) {
      const brand = await createOrFindBrand(item.brand?.trim() || 'Unknown', actor)
      const watchId = newId('wch')
      await db.insert(watches).values({
        id: watchId,
        stockNo: await nextStockNo(),
        brandId: brand.id,
        model: item.model?.trim() || item.description.trim(),
        serial: item.serial?.trim() || null,
        year: item.year ?? null,
        supplierId: supplier.id,
        purchaseDate: when,
        purchasePriceGbp: costs[index] ?? 0,
        locationId,
        status: 'IN_STOCK',
        createdById: actor.id,
        notes: `Taken into stock on a defaulted buy-back${loan.reference ? ` (${loan.reference})` : ''}.`,
      })
      await db.update(buybackItems).set({ watchId }).where(eq(buybackItems.id, item.id))
      created.push(watchId)
    }

    await db.update(buybacks)
      .set({ status: 'DEFAULTED', closedOn: when, updatedAt: new Date() })
      .where(eq(buybacks.id, id))

    await recordAudit({
      entityType: 'Buyback', entityId: id, action: 'UPDATE', actorId: actor.id,
      summary: `${actor.name} defaulted ${loan.customerName}'s buy-back; ${created.length} watch(es) taken into stock`,
    })
    return created
  })
}

/**
 * Split one sum across several things, exactly.
 *
 * Weighted by each item's own valuation where there are any, evenly where
 * there are none. The remainder goes on the first rather than being
 * dropped, so the parts add up to the whole — a cost basis that is a fil
 * short of what was lent is a rounding error that never stops being
 * visible once it is in the ledger.
 */
export function shareOut(total: number, weights: Array<number | null>): number[] {
  const usable = weights.every((weight) => weight !== null && weight > 0)
    ? (weights as number[])
    : weights.map(() => 1)
  const sum = usable.reduce((a, b) => a + b, 0)
  if (sum <= 0) return weights.map(() => 0)

  const parts = usable.map((weight) => Math.floor((total * weight) / sum))
  const allocated = parts.reduce((a, b) => a + b, 0)
  parts[0] += total - allocated
  return parts
}

/* ================= reading them back ================= */

/** A charge is live unless it was voided. */
function liveCharge() {
  return isNull(buybackCharges.voidedAt)
}

export interface BuybackSummary {
  id: string
  reference: string | null
  customerId: string | null
  customerName: string
  principalAmount: number
  principalCurrency: CurrencyCode
  principalBase: number
  rateBps: number
  monthlyBase: number
  startedOn: Date
  dueOn: Date | null
  status: BuybackStatus
  closedOn: Date | null
  soldByName: string | null
  notes: string | null
  /** Interest and fees raised so far, and how much of it is in. */
  chargedBase: number
  paidBase: number
  items: number
}

/**
 * Every buy-back, with its money alongside it.
 *
 * Accrual runs first, so the figures are right the moment the page loads
 * rather than right the last time somebody remembered to press something.
 */
export async function listBuybacks(status?: BuybackStatus[]): Promise<BuybackSummary[]> {
  await accrueAllOpen()

  const where = [isNull(buybacks.deletedAt)]
  if (status?.length) where.push(inArray(buybacks.status, status))

  const rows = await db
    .select({
      id: buybacks.id,
      reference: buybacks.reference,
      customerId: buybacks.customerId,
      customerName: buybacks.customerName,
      principalAmount: buybacks.principalAmount,
      principalCurrency: buybacks.principalCurrency,
      principalBase: buybacks.principalBase,
      rateBps: buybacks.rateBps,
      monthlyBase: buybacks.monthlyBase,
      startedOn: buybacks.startedOn,
      dueOn: buybacks.dueOn,
      status: buybacks.status,
      closedOn: buybacks.closedOn,
      soldByName: salesPeople.name,
      notes: buybacks.notes,
      chargedBase: sql<number>`(
        SELECT coalesce(sum(c.amount_base), 0) FROM buyback_charges c
        WHERE c.buyback_id = ${buybacks.id} AND c.voided_at IS NULL
      )`.mapWith(Number),
      paidBase: sql<number>`(
        SELECT coalesce(sum(c.amount_base), 0) FROM buyback_charges c
        WHERE c.buyback_id = ${buybacks.id} AND c.voided_at IS NULL
          AND c.payment_status = 'PAID'
      )`.mapWith(Number),
      items: sql<number>`(
        SELECT count(*) FROM buyback_items i WHERE i.buyback_id = ${buybacks.id}
      )`.mapWith(Number),
    })
    .from(buybacks)
    .leftJoin(salesPeople, eq(salesPeople.id, buybacks.soldById))
    .where(and(...where))
    // Open first and oldest first within that: the one that has been
    // running longest is the one most likely to need chasing.
    .orderBy(asc(buybacks.status), asc(buybacks.startedOn))

  return rows as BuybackSummary[]
}

export interface BuybackCharge {
  id: string
  kind: BuybackChargeKind
  periodIndex: number | null
  dueOn: Date
  amount: number
  currency: CurrencyCode
  amountBase: number
  paymentStatus: string
  paidOn: Date | null
  notes: string | null
}

/** One loan, with what secures it and every charge on it. */
export async function getBuyback(id: string): Promise<{
  loan: BuybackSummary
  items: Array<typeof buybackItems.$inferSelect>
  charges: BuybackCharge[]
} | null> {
  await accrueInterest(id)

  const [loan] = await listBuybacks().then((all) => all.filter((row) => row.id === id))
  if (!loan) return null

  const [items, charges] = await Promise.all([
    db.select().from(buybackItems).where(eq(buybackItems.buybackId, id))
      .orderBy(asc(buybackItems.createdAt)),
    db.select({
      id: buybackCharges.id,
      kind: buybackCharges.kind,
      periodIndex: buybackCharges.periodIndex,
      dueOn: buybackCharges.dueOn,
      amount: buybackCharges.amount,
      currency: buybackCharges.currency,
      amountBase: buybackCharges.amountBase,
      paymentStatus: buybackCharges.paymentStatus,
      paidOn: buybackCharges.paidOn,
      notes: buybackCharges.notes,
    }).from(buybackCharges)
      .where(and(eq(buybackCharges.buybackId, id), liveCharge()))
      .orderBy(asc(buybackCharges.dueOn)),
  ])

  return { loan, items, charges: charges as BuybackCharge[] }
}

/**
 * What buy-backs earned in a window.
 *
 * Interest and fees only. The principal is not in here and never will be:
 * lending it is not a cost and getting it back is not income, so including
 * either would make a month look like a windfall or a disaster depending
 * on which way the money happened to move that week.
 */
export async function buybackTotals(from?: Date, to?: Date): Promise<{
  paid: number
  pending: number
  total: number
  count: number
}> {
  const window = [liveCharge()]
  if (from) window.push(gte(buybackCharges.dueOn, from))
  if (to) window.push(lte(buybackCharges.dueOn, to))

  const [row] = await db
    .select({
      paid: sql<number>`coalesce(sum(${buybackCharges.amountBase}) filter (where ${buybackCharges.paymentStatus} = 'PAID'), 0)`,
      pending: sql<number>`coalesce(sum(${buybackCharges.amountBase}) filter (where ${buybackCharges.paymentStatus} <> 'PAID'), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(buybackCharges)
    .where(and(...window))

  const paid = Number(row?.paid ?? 0)
  const pending = Number(row?.pending ?? 0)
  return { paid, pending, total: paid + pending, count: Number(row?.count ?? 0) }
}

/** What is still out on loan: capital lent that has not come back. */
export async function principalOutstanding(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${buybacks.principalBase}), 0)` })
    .from(buybacks)
    .where(and(eq(buybacks.status, 'OPEN'), isNull(buybacks.deletedAt)))
  return Number(row?.total ?? 0)
}

/** Buy-back earnings by the person who wrote the loan. */
export async function buybackByPerson(from?: Date, to?: Date): Promise<
  Array<{ soldById: string | null; name: string; total: number; count: number }>
> {
  const window = [liveCharge()]
  if (from) window.push(gte(buybackCharges.dueOn, from))
  if (to) window.push(lte(buybackCharges.dueOn, to))

  const rows = await db
    .select({
      soldById: buybacks.soldById,
      name: salesPeople.name,
      total: sql<number>`coalesce(sum(${buybackCharges.amountBase}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(buybackCharges)
    .innerJoin(buybacks, eq(buybacks.id, buybackCharges.buybackId))
    .leftJoin(salesPeople, eq(salesPeople.id, buybacks.soldById))
    .where(and(isNull(buybacks.deletedAt), ...window))
    .groupBy(buybacks.soldById, salesPeople.name)

  return rows.map((row) => ({
    soldById: row.soldById,
    name: row.name ?? 'Not recorded',
    total: Number(row.total),
    count: Number(row.count),
  }))
}

/**
 * Charges as rows for the sales ledger.
 *
 * Buy-back income sits in the one list with sales and commissions, because
 * that is how the month's earnings are thought about — asking somebody to
 * look in three places and add up is how a figure gets missed.
 */
export async function listBuybackCharges(from?: Date, to?: Date, cap = 2000): Promise<Array<{
  id: string
  buybackId: string
  kind: BuybackChargeKind
  periodIndex: number | null
  dueOn: Date
  amount: number
  currency: CurrencyCode
  amountBase: number
  paymentStatus: string
  reference: string | null
  customerName: string
  soldByName: string | null
}>> {
  await accrueAllOpen()

  const window = [liveCharge(), isNull(buybacks.deletedAt)]
  if (from) window.push(gte(buybackCharges.dueOn, from))
  if (to) window.push(lte(buybackCharges.dueOn, to))

  const rows = await db
    .select({
      id: buybackCharges.id,
      buybackId: buybackCharges.buybackId,
      kind: buybackCharges.kind,
      periodIndex: buybackCharges.periodIndex,
      dueOn: buybackCharges.dueOn,
      amount: buybackCharges.amount,
      currency: buybackCharges.currency,
      amountBase: buybackCharges.amountBase,
      paymentStatus: buybackCharges.paymentStatus,
      reference: buybacks.reference,
      customerName: buybacks.customerName,
      soldByName: salesPeople.name,
    })
    .from(buybackCharges)
    .innerJoin(buybacks, eq(buybacks.id, buybackCharges.buybackId))
    .leftJoin(salesPeople, eq(salesPeople.id, buybacks.soldById))
    .where(and(...window))
    .orderBy(desc(buybackCharges.dueOn))
    .limit(cap)

  return rows as Awaited<ReturnType<typeof listBuybackCharges>>
}

/** Buy-back earnings per person, with the name and the latest date. */
export async function buybackByPersonDetailed(from?: Date, to?: Date, onlyPersonId?: string): Promise<
  Array<{ personId: string | null; personName: string | null; count: number; total: number; lastAt: Date | null }>
> {
  const window = [liveCharge(), isNull(buybacks.deletedAt)]
  if (from) window.push(gte(buybackCharges.dueOn, from))
  if (to) window.push(lte(buybackCharges.dueOn, to))
  if (onlyPersonId) window.push(eq(buybacks.soldById, onlyPersonId))

  const rows = await db
    .select({
      personId: buybacks.soldById,
      personName: salesPeople.name,
      count: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(${buybackCharges.amountBase}), 0)`,
      lastAt: sql<Date | null>`max(${buybackCharges.dueOn})`,
    })
    .from(buybackCharges)
    .innerJoin(buybacks, eq(buybacks.id, buybackCharges.buybackId))
    .leftJoin(salesPeople, eq(salesPeople.id, buybacks.soldById))
    .where(and(...window))
    .groupBy(buybacks.soldById, salesPeople.name)

  return rows.map((row) => ({
    personId: row.personId,
    personName: row.personName,
    count: Number(row.count),
    total: Number(row.total),
    lastAt: row.lastAt ? new Date(row.lastAt) : null,
  }))
}
