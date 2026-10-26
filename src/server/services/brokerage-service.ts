import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { brands, brokerages, buybackCharges, buybacks, sales, salesPeople, watches } from '../db/schema'
import { newId } from '@/lib/ids'
import { recordAudit } from './audit'
import { ConflictError, NotFoundError } from '@/lib/errors'
import { getRateTable } from './fx-service'
import { BASE_CURRENCY, type CurrencyCode } from '@/lib/enums'
import type { BrokerageAmendInput } from '@/lib/validation'
import { RATE_SCALE, type RateTable } from '@/lib/currency'
import { commissionForMonth, salesByPerson } from '../repositories/sale-repository'
import type { SessionUser } from '../auth/session'

/**
 * Fees earned selling other people's watches.
 *
 * A brokered deal is income rather than trading revenue: nothing was bought,
 * nothing was held and nothing left the shelf, so none of it belongs in the
 * figures built out of stock — average sale price, margin, stock turn. It is
 * added up alongside them and reported on its own line.
 *
 * The fee is the whole of what was earned, so where a stock sale contributes
 * its profit to a salesperson's commission, a brokered one contributes all
 * of itself.
 */

/** Live rows only: not voided, not deleted. */
const live = () => and(isNull(brokerages.voidedAt), isNull(brokerages.deletedAt))

/**
 * The agreed fee in base minor units.
 *
 * Same arithmetic as a sale, and deliberately the same shape: the figure on
 * the paperwork is kept as agreed, and the base figure is derived once here
 * so every report adds up the same number.
 */
export function feeInBase(amount: number, currency: CurrencyCode, rates: RateTable): {
  feeBase: number
  feeFxRate: number
} {
  const rate = currency === BASE_CURRENCY ? RATE_SCALE : rates[currency] ?? RATE_SCALE
  return {
    feeBase: currency === BASE_CURRENCY ? amount : Math.round((amount * RATE_SCALE) / rate),
    feeFxRate: rate,
  }
}

export interface BrokerageInput {
  /**
   * A watch of ours this fee was earned on.
   *
   * Setting it marks that watch sold, which is what takes it out of the
   * stock list and archives its page on the storefront. Left out for the
   * common case: a fee on somebody else's watch, which was never ours to
   * remove.
   */
  watchId?: string | null
  description: string
  soldFor?: string | null
  soldTo?: string | null
  customerId?: string | null
  brokeredOn: Date
  reference?: string | null
  feeAmount: number
  feeCurrency: CurrencyCode
  paymentStatus: 'PAID' | 'DEPOSIT' | 'PENDING' | 'OVERDUE' | 'REFUNDED'
  soldById?: string | null
  notes?: string | null
}

export async function recordBrokerage(input: BrokerageInput, actor: SessionUser): Promise<string> {
  const rates = await getRateTable()
  const { feeBase, feeFxRate } = feeInBase(input.feeAmount, input.feeCurrency, rates)
  const id = newId('brk')

  if (input.watchId) await assertBrokerable(input.watchId)

  await withTransaction(async () => {
  await db.insert(brokerages).values({
    id,
    watchId: input.watchId ?? null,
    description: input.description,
    soldFor: input.soldFor ?? null,
    soldTo: input.soldTo ?? null,
    customerId: input.customerId ?? null,
    brokeredOn: input.brokeredOn,
    reference: input.reference ?? null,
    feeAmount: input.feeAmount,
    feeCurrency: input.feeCurrency,
    feeFxRate,
    feeBase,
    paymentStatus: input.paymentStatus,
    soldById: input.soldById ?? null,
    notes: input.notes ?? null,
    recordedById: actor.id,
  })

  /*
   * The watch goes with it, in the same transaction.
   *
   * A fee recorded while the watch stayed in stock is the failure this
   * exists to prevent: the piece is gone, the website still offers it and
   * the stock list still counts its capital. SOLD is the status that takes
   * it out of both — the storefront plan archives anything not held.
   */
  if (input.watchId) {
    await db.update(watches)
      .set({ status: 'SOLD', updatedAt: new Date() })
      .where(eq(watches.id, input.watchId))
    await recordAudit({
      entityType: 'Watch',
      entityId: input.watchId,
      action: 'SELL',
      summary: `${actor.name} sold it on commission — ${input.description}`,
      actorId: actor.id,
    })
  }
  })

  await recordAudit({
    entityType: 'Brokerage',
    entityId: id,
    action: 'CREATE',
    summary: `${actor.name} recorded a commission on ${input.description}`,
    actorId: actor.id,
  })
  return id
}

/**
 * A watch may carry one fee, and not alongside a sale.
 *
 * Both of these are double counts of the same event rather than two
 * events, and both are far cheaper to refuse here than to find later in a
 * month's figures.
 */
async function assertBrokerable(watchId: string): Promise<void> {
  const [existingSale] = await db.select({ id: sales.id }).from(sales)
    .where(and(eq(sales.watchId, watchId), isNull(sales.voidedAt), isNull(sales.deletedAt)))
    .limit(1)
  if (existingSale) {
    throw new ConflictError(
      'That watch already has a sale recorded against it. Void the sale first, '
      + 'or use "Record as commission" on the sale itself.',
    )
  }
  const [existingFee] = await db.select({ id: brokerages.id }).from(brokerages)
    .where(and(eq(brokerages.watchId, watchId), isNull(brokerages.voidedAt), isNull(brokerages.deletedAt)))
    .limit(1)
  if (existingFee) throw new ConflictError('That watch already has a commission recorded against it.')
}

/** Void rather than delete: a fee invoiced and cancelled is still a fact. */
export async function voidBrokerage(id: string, reason: string, actor: SessionUser): Promise<void> {
  await db.update(brokerages)
    .set({ voidedAt: new Date(), voidedById: actor.id, voidReason: reason, updatedAt: new Date() })
    .where(eq(brokerages.id, id))
  await recordAudit({
    entityType: 'Brokerage',
    entityId: id,
    action: 'UPDATE',
    summary: `${actor.name} voided a commission — ${reason}`,
    actorId: actor.id,
  })
}

/**
 * Correcting a commission after the fact.
 *
 * There was no way to. A commission could be recorded, voided, or have a
 * watch attached, and nothing else — so the reference was write-once at the
 * moment of recording. The invoice usually arrives afterwards, which made the
 * only route to putting it on the record voiding the commission and entering
 * it again, losing the audit trail to a typo.
 *
 * The sale verbs were deliberately taken off a commission row — "Correct this
 * sale" opened a form addressed by an id belonging to another table — and
 * correctly so. This is the commission-shaped replacement that was never
 * built: the paperwork around the fee, not the fee itself.
 *
 * The fee is not here on purpose. It is the one field the reports add up, and
 * `feeBase` is derived from the amount, the currency and the rate on the day;
 * changing it means re-deriving all three, which is a different job from
 * typing in an invoice number. A fee agreed wrongly is still a void and
 * re-enter, and that is the right amount of friction for restating income.
 *
 * Only what is named is written, so a form that sends one field leaves the
 * other five alone.
 */
export async function amendBrokerage(
  id: string,
  input: BrokerageAmendInput,
  actor: SessionUser,
): Promise<void> {
  const [existing] = await db.select().from(brokerages).where(eq(brokerages.id, id)).limit(1)
  if (!existing || existing.deletedAt) throw new NotFoundError('Commission')
  // A voided commission is not a record to keep tidy, it is one that was
  // withdrawn. Editing it would put a corrected invoice number on income
  // nobody is claiming.
  if (existing.voidedAt) {
    throw new ConflictError('That commission was voided, so it can no longer be corrected.')
  }

  const patch: Partial<typeof brokerages.$inferInsert> = { updatedAt: new Date() }
  /*
   * An emptied box and a box never filled are the same fact, and the column
   * should hold one value for it. The schema already folds "" to null on the
   * way in, so this is belt and braces — but a service that trusts every
   * caller to have parsed first is one direct call away from a row whose
   * reference is an empty string, which reads as "recorded, and blank".
   */
  const blankIsNull = (value: string | null | undefined) =>
    value === undefined ? undefined : (value?.trim() || null)

  if (input.reference !== undefined) patch.reference = blankIsNull(input.reference)
  if (input.soldFor !== undefined) patch.soldFor = blankIsNull(input.soldFor)
  if (input.soldTo !== undefined) patch.soldTo = blankIsNull(input.soldTo)
  if (input.paymentStatus !== undefined) patch.paymentStatus = input.paymentStatus
  if (input.brokeredOn !== undefined) patch.brokeredOn = input.brokeredOn
  if (input.notes !== undefined) patch.notes = blankIsNull(input.notes)

  await db.update(brokerages).set(patch).where(eq(brokerages.id, id))

  // What changed, in the words of the ledger rather than the column names,
  // so the audit log reads as a sentence about a commission.
  const LABELS: Record<string, string> = {
    reference: 'invoice', soldFor: 'sold for', soldTo: 'sold to',
    paymentStatus: 'payment', brokeredOn: 'date', notes: 'notes',
  }
  const touched = Object.keys(patch)
    .filter((key) => key !== 'updatedAt')
    .map((key) => LABELS[key] ?? key)

  await recordAudit({
    entityType: 'Brokerage',
    entityId: id,
    action: 'UPDATE',
    summary: touched.length
      ? `${actor.name} corrected the ${touched.join(', ')} on a commission`
      : `${actor.name} saved a commission with nothing changed`,
    actorId: actor.id,
  })
}

export interface BrokerageRow {
  id: string
  description: string
  /** The watch of ours, where one is linked. Null for somebody else's. */
  watchId: string | null
  stockNo: number | null
  brandName: string | null
  model: string | null
  soldFor: string | null
  soldTo: string | null
  brokeredOn: Date
  reference: string | null
  feeAmount: number
  feeCurrency: string
  feeBase: number
  paymentStatus: string
  soldByName: string | null
  notes: string | null
}

/** The commissions in a window, newest first. */
export async function listBrokerages(from?: Date, to?: Date, limit = 100): Promise<BrokerageRow[]> {
  const window = [live()]
  if (from) window.push(gte(brokerages.brokeredOn, from))
  if (to) window.push(lte(brokerages.brokeredOn, to))

  return db
    .select({
      id: brokerages.id,
      description: brokerages.description,
      soldFor: brokerages.soldFor,
      soldTo: brokerages.soldTo,
      brokeredOn: brokerages.brokeredOn,
      reference: brokerages.reference,
      feeAmount: brokerages.feeAmount,
      feeCurrency: brokerages.feeCurrency,
      feeBase: brokerages.feeBase,
      paymentStatus: brokerages.paymentStatus,
      soldByName: salesPeople.name,
      notes: brokerages.notes,
      // The linked watch, so the row can carry a stock number and a link
      // into the record like every other row in the ledger.
      watchId: brokerages.watchId,
      stockNo: watches.stockNo,
      brandName: brands.name,
      model: watches.model,
    })
    .from(brokerages)
    .leftJoin(salesPeople, eq(salesPeople.id, brokerages.soldById))
    .leftJoin(watches, eq(watches.id, brokerages.watchId))
    .leftJoin(brands, eq(brands.id, watches.brandId))
    .where(and(...window))
    .orderBy(desc(brokerages.brokeredOn))
    .limit(limit)
}

/**
 * What was earned in commission over a window.
 *
 * Paid and unpaid separately, for the same reason the sales ledger keeps
 * them apart: paying somebody on an invoice the client has not settled is a
 * decision for whoever signs the cheque, not for a sum.
 */
export async function brokerageTotals(from?: Date, to?: Date): Promise<{
  paid: number
  pending: number
  total: number
  count: number
}> {
  // Open-ended rather than bounded by a sentinel date. The obvious
  // `new Date(8.64e15)` is a valid JavaScript date and not a valid Postgres
  // one — it fails the whole query with "time zone displacement out of
  // range", which is a page that does not load rather than a total that is
  // wrong.
  const window = [live()]
  if (from) window.push(gte(brokerages.brokeredOn, from))
  if (to) window.push(lte(brokerages.brokeredOn, to))

  const [row] = await db
    .select({
      paid: sql<number>`coalesce(sum(${brokerages.feeBase}) filter (where ${brokerages.paymentStatus} = 'PAID'), 0)`,
      pending: sql<number>`coalesce(sum(${brokerages.feeBase}) filter (where ${brokerages.paymentStatus} <> 'PAID'), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(brokerages)
    .where(and(...window))

  const paid = Number(row?.paid ?? 0)
  const pending = Number(row?.pending ?? 0)
  return { paid, pending, total: paid + pending, count: Number(row?.count ?? 0) }
}

/**
 * Commission income by salesperson, for the month's commission run.
 *
 * Returned in the same shape the sales ledger uses so the two can simply be
 * added: the fee is the profit, so it lands in the profit columns.
 */
export async function brokerageByPerson(from?: Date, to?: Date): Promise<Array<{
  personId: string | null
  paidProfit: number
  paidCount: number
  pendingProfit: number
  pendingCount: number
}>> {
  const rows = await db
    .select({
      personId: brokerages.soldById,
      paidProfit: sql<number>`coalesce(sum(${brokerages.feeBase}) filter (where ${brokerages.paymentStatus} = 'PAID'), 0)`,
      paidCount: sql<number>`count(*) filter (where ${brokerages.paymentStatus} = 'PAID')`,
      pendingProfit: sql<number>`coalesce(sum(${brokerages.feeBase}) filter (where ${brokerages.paymentStatus} <> 'PAID'), 0)`,
      pendingCount: sql<number>`count(*) filter (where ${brokerages.paymentStatus} <> 'PAID')`,
    })
    .from(brokerages)
    .where(and(
      live(),
      ...(from ? [gte(brokerages.brokeredOn, from)] : []),
      ...(to ? [lte(brokerages.brokeredOn, to)] : []),
    ))
    .groupBy(brokerages.soldById)

  return rows.map((row) => ({
    personId: row.personId,
    paidProfit: Number(row.paidProfit),
    paidCount: Number(row.paidCount),
    pendingProfit: Number(row.pendingProfit),
    pendingCount: Number(row.pendingCount),
  }))
}

/**
 * The month's commissionable earnings per person: stock sales and brokerage.
 *
 * One function so the commission report, the running-costs page and the
 * profit and loss cannot come to different answers about what somebody
 * earned. The sales ledger contributes the profit on their sales and this
 * contributes the whole of their fees, because a fee has no cost under it.
 */
export async function commissionBaseForMonth(from: Date, to: Date) {
  const [ledger, brokered] = await Promise.all([
    commissionForMonth(from, to),
    brokerageByPerson(from, to),
  ])
  const extra = new Map(brokered.filter((row) => row.personId).map((row) => [row.personId, row]))

  return ledger.map((row) => {
    const fees = extra.get(row.personId)
    if (!fees) return row
    return {
      ...row,
      paidProfit: Number(row.paidProfit) + fees.paidProfit,
      paidCount: Number(row.paidCount) + fees.paidCount,
      pendingProfit: Number(row.pendingProfit) + fees.pendingProfit,
      pendingCount: Number(row.pendingCount) + fees.pendingCount,
    }
  })
}

/**
 * Sales by person, with brokered deals counted in.
 *
 * Same shape as `salesByPerson`, plus `stockProfit` — the profit on their
 * own stock, kept apart so the margin beside it stays a margin. A fee has
 * no cost under it, so adding it to profit without adding anything to cost
 * would inflate every percentage on the page.
 */
export async function salesByPersonWithBrokerage(from?: Date, to?: Date, onlyPersonId?: string) {
  const { buybackByPersonDetailed } = await import('./buyback-service')
  const [ledger, fees, interest] = await Promise.all([
    salesByPerson(from, to, onlyPersonId),
    brokerageByPersonDetailed(from, to, onlyPersonId),
    buybackByPersonDetailed(from, to, onlyPersonId),
  ])

  const rows = ledger.map((row) => ({
    ...row,
    soldCount: Number(row.soldCount),
    revenueGbp: Number(row.revenueGbp),
    profitGbp: Number(row.profitGbp),
    costGbp: Number(row.costGbp),
    /** Profit on their own stock, which is what a margin is measured on. */
    stockProfitGbp: Number(row.profitGbp),
    /**
     * Watches, before the fees are folded in beside them.
     *
     * Kept so a page can say "one watch and one brokered deal" rather than
     * "2". Two deals adding up to a profit and a margin that plainly do not
     * belong to each other is a figure somebody has to come and ask about,
     * and the answer is always this split.
     */
    stockCount: Number(row.soldCount),
  }))
  const byId = new Map(rows.map((row) => [row.personId ?? 'none', row]))

  // Brokered fees and buy-back charges fold in the same way: earnings with
  // no stock under them. Walked as one list rather than two loops, because
  // the second loop is where the third income source gets forgotten.
  for (const fee of [...fees, ...interest]) {
    const key = fee.personId ?? 'none'
    const existing = byId.get(key)
    if (existing) {
      existing.soldCount += fee.count
      existing.revenueGbp += fee.total
      existing.profitGbp += fee.total
      // Not stockProfit, and not cost: a fee has neither.
      if (!existing.lastSaleAt || (fee.lastAt && fee.lastAt > existing.lastSaleAt)) {
        existing.lastSaleAt = fee.lastAt
      }
      continue
    }
    // Somebody whose only earnings this period were a fee or a buy-back.
    // Without this they would be missing from a report that is meant to
    // list everybody.
    const row = {
      personId: fee.personId,
      personName: fee.personName ?? 'Not recorded',
      soldCount: fee.count,
      revenueGbp: fee.total,
      profitGbp: fee.total,
      costGbp: 0,
      stockProfitGbp: 0,
      // No watch left the shelf for a fee, so none of this is stock.
      stockCount: 0,
      lastSaleAt: fee.lastAt,
    }
    rows.push(row as typeof rows[number])
    byId.set(key, row as typeof rows[number])
  }

  return rows
}

/**
 * Everything a salesperson earned, month by month, from all three sources.
 *
 * Alex: "Brokered deals are pure profit, ignore them for Margin" and
 * "commision earned should be 25% of the total amount including brokered
 * deals." Two halves of one rule, and they pull in opposite directions on
 * purpose:
 *
 *   margin      stock only — a fee has no cost, so there is nothing for a
 *               percentage to be of
 *   commission  everything — a fee is money the person brought in, and a
 *               quarter of it is theirs
 *
 * So the commission figure is taken of the profit on the watches they sold
 * and the fees on the deals they brokered. Commission used to be worked out
 * on sales alone on this page, which paid somebody nothing for a brokered
 * deal that was pure profit to the firm.
 *
 * Buy-back charges are deliberately not in here. They are in the Profit
 * card, because the money is theirs to have earned, and the firm's own
 * commission run has never paid on them — `commissionBaseForMonth` is
 * sales and brokerage, and these two must agree to the penny or the
 * salesperson and the person signing the cheque are reading different
 * numbers. Changing what a buy-back earns is a decision about money, not
 * about a screen, so it is not made here.
 *
 * Paid and pending stay apart. All three sources carry a payment status, so
 * "earned" means the customer has settled and "if everything settles" means
 * the rest lands too; neither is guessed.
 *
 * Grouped by the month of the sale, the deal or the charge, because the
 * commission rule is monthly: a share above a retainer, settled afresh each
 * month. One row per person per month, summed across the three.
 */
export async function earningsByPersonMonth(
  from?: Date, to?: Date, personId?: string,
): Promise<Array<{ personId: string | null; month: string; paidProfit: number; pendingProfit: number }>> {
  const saleWindow = [isNull(sales.voidedAt), isNull(sales.deletedAt)]
  if (from) saleWindow.push(gte(sales.saleDate, from))
  if (to) saleWindow.push(lte(sales.saleDate, to))
  if (personId) saleWindow.push(eq(sales.soldById, personId))

  const feeWindow = [...[live()]]
  if (from) feeWindow.push(gte(brokerages.brokeredOn, from))
  if (to) feeWindow.push(lte(brokerages.brokeredOn, to))
  if (personId) feeWindow.push(eq(brokerages.soldById, personId))

  const [fromSales, fromFees] = await Promise.all([
    db.select({
      personId: sales.soldById,
      month: sql<string>`to_char(${sales.saleDate}, 'YYYY-MM')`.as('month'),
      paid: sql<number>`coalesce(sum(${sales.profitGbp}) filter (where ${sales.paymentStatus} = 'PAID'), 0)`,
      pending: sql<number>`coalesce(sum(${sales.profitGbp}) filter (where ${sales.paymentStatus} <> 'PAID'), 0)`,
    }).from(sales).where(and(...saleWindow)).groupBy(sales.soldById, sql`2`),

    db.select({
      personId: brokerages.soldById,
      month: sql<string>`to_char(${brokerages.brokeredOn}, 'YYYY-MM')`.as('month'),
      paid: sql<number>`coalesce(sum(${brokerages.feeBase}) filter (where ${brokerages.paymentStatus} = 'PAID'), 0)`,
      pending: sql<number>`coalesce(sum(${brokerages.feeBase}) filter (where ${brokerages.paymentStatus} <> 'PAID'), 0)`,
    }).from(brokerages).where(and(...feeWindow)).groupBy(brokerages.soldById, sql`2`),
  ])

  // Keyed on person and month together, so the three sources land on the
  // same row wherever they share one.
  const byKey = new Map<string, { personId: string | null; month: string; paidProfit: number; pendingProfit: number }>()
  for (const row of [...fromSales, ...fromFees]) {
    const key = `${row.personId ?? 'none'}|${row.month}`
    const found = byKey.get(key) ?? { personId: row.personId, month: row.month, paidProfit: 0, pendingProfit: 0 }
    found.paidProfit += Number(row.paid)
    found.pendingProfit += Number(row.pending)
    byKey.set(key, found)
  }
  return [...byKey.values()].sort((a, b) => a.month.localeCompare(b.month))
}

/**
 * Every deal one person did in the period, as a list rather than a total.
 *
 * Alex: "Show an actual breakdown of deals done and then the commision
 * too." A single row reading "2 · AED 113,690 · +AED 19,690" is a figure to
 * be taken on trust, and the first thing anybody does with a figure they
 * cannot see inside is dispute it. These are the deals the totals are made
 * of, each with what it earned and what it is worth to the person who did
 * it.
 *
 * All three sources, in one list, because from where the salesperson
 * stands they are all deals they did: a watch off the shelf, a watch of
 * somebody else's brokered for a fee, and a charge on a buy-back they
 * wrote. The `kind` says which, so the page can be honest about what it is
 * showing without three tables.
 *
 * Sorted newest first, which is the order somebody checks their own month
 * in.
 */
export interface PersonDeal {
  kind: 'sale' | 'brokered' | 'buyback'
  id: string
  date: Date
  /** What it was: the watch, or the thing brokered. */
  title: string
  /** The stock number, where one exists — nothing for somebody else's watch. */
  stockNo: number | null
  reference: string | null
  /** What the customer paid. A fee has no sale price of its own. */
  amount: number | null
  /** What it earned the firm, which is what a commission is taken of. */
  profit: number
  paymentStatus: string
}

export async function dealsFor(personId: string, from?: Date, to?: Date): Promise<PersonDeal[]> {
  const saleWindow = [isNull(sales.voidedAt), isNull(sales.deletedAt), eq(sales.soldById, personId)]
  if (from) saleWindow.push(gte(sales.saleDate, from))
  if (to) saleWindow.push(lte(sales.saleDate, to))

  const feeWindow = [live(), eq(brokerages.soldById, personId)]
  if (from) feeWindow.push(gte(brokerages.brokeredOn, from))
  if (to) feeWindow.push(lte(brokerages.brokeredOn, to))

  const chargeWindow = [
    isNull(buybackCharges.voidedAt), isNull(buybacks.deletedAt), eq(buybacks.soldById, personId),
  ]
  if (from) chargeWindow.push(gte(buybackCharges.dueOn, from))
  if (to) chargeWindow.push(lte(buybackCharges.dueOn, to))

  const [soldRows, feeRows, chargeRows] = await Promise.all([
    db.select({
      id: sales.id,
      date: sales.saleDate,
      invoiceNo: sales.invoiceNo,
      amount: sales.saleAmountGbp,
      profit: sales.profitGbp,
      paymentStatus: sales.paymentStatus,
      stockNo: watches.stockNo,
      model: watches.model,
      brand: brands.name,
    })
      .from(sales)
      .innerJoin(watches, eq(watches.id, sales.watchId))
      .leftJoin(brands, eq(brands.id, watches.brandId))
      .where(and(...saleWindow)),

    db.select({
      id: brokerages.id,
      date: brokerages.brokeredOn,
      description: brokerages.description,
      reference: brokerages.reference,
      soldFor: brokerages.soldFor,
      fee: brokerages.feeBase,
      paymentStatus: brokerages.paymentStatus,
    }).from(brokerages).where(and(...feeWindow)),

    db.select({
      id: buybackCharges.id,
      date: buybackCharges.dueOn,
      amount: buybackCharges.amountBase,
      paymentStatus: buybackCharges.paymentStatus,
      reference: buybacks.reference,
    })
      .from(buybackCharges)
      .innerJoin(buybacks, eq(buybacks.id, buybackCharges.buybackId))
      .where(and(...chargeWindow)),
  ])

  const deals: PersonDeal[] = [
    ...soldRows.map((row) => ({
      kind: 'sale' as const,
      id: row.id,
      date: row.date,
      title: [row.brand, row.model].filter(Boolean).join(' ') || 'Watch',
      stockNo: row.stockNo,
      reference: row.invoiceNo,
      amount: Number(row.amount),
      profit: Number(row.profit),
      paymentStatus: row.paymentStatus,
    })),
    ...feeRows.map((row) => ({
      kind: 'brokered' as const,
      id: row.id,
      date: row.date,
      title: row.description,
      stockNo: null,
      reference: row.reference,
      // A fee is not a sale price. What the piece went for is the other
      // party's figure, and putting it in this column would make the
      // revenue on this page disagree with the ledger.
      amount: null,
      profit: Number(row.fee),
      paymentStatus: row.paymentStatus,
    })),
    ...chargeRows.map((row) => ({
      kind: 'buyback' as const,
      id: row.id,
      date: row.date,
      title: 'Buy-back charge',
      stockNo: null,
      reference: row.reference,
      amount: null,
      profit: Number(row.amount),
      paymentStatus: row.paymentStatus,
    })),
  ]
  return deals.sort((a, b) => b.date.getTime() - a.date.getTime())
}

/** Brokerage per person, with the name and the latest date. */
async function brokerageByPersonDetailed(from?: Date, to?: Date, onlyPersonId?: string) {
  const window = [live()]
  if (from) window.push(gte(brokerages.brokeredOn, from))
  if (to) window.push(lte(brokerages.brokeredOn, to))
  if (onlyPersonId) window.push(eq(brokerages.soldById, onlyPersonId))

  const rows = await db
    .select({
      personId: brokerages.soldById,
      personName: salesPeople.name,
      count: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(${brokerages.feeBase}), 0)`,
      lastAt: sql<Date | null>`max(${brokerages.brokeredOn})`,
    })
    .from(brokerages)
    .leftJoin(salesPeople, eq(salesPeople.id, brokerages.soldById))
    .where(and(...window))
    .groupBy(brokerages.soldById, salesPeople.name)

  return rows.map((row) => ({ ...row, count: Number(row.count), total: Number(row.total) }))
}

/**
 * A sale that should have been a commission.
 *
 * The watch went out and somebody booked it as a direct sale, inventing a
 * cost and a margin for a piece that earned a fee instead. Rather than
 * making anybody unpick that by hand — void the sale, remember the
 * salesperson, retype the watch, re-record the fee — this does the whole
 * swap in one transaction.
 *
 * The sale is voided rather than deleted, as every correction here is: an
 * invoice that was issued is a fact, and the reports already skip voided
 * rows. The watch stays sold, because it did sell; only what the business
 * earned on it changes.
 */
export async function convertSaleToBrokerage(
  saleId: string,
  fee: { amount: number; currency: CurrencyCode },
  actor: SessionUser,
): Promise<string> {
  const [sale] = await db
    .select({
      id: sales.id,
      watchId: sales.watchId,
      saleDate: sales.saleDate,
      soldById: sales.soldById,
      customerName: sales.customerName,
      customerId: sales.customerId,
      invoiceNo: sales.invoiceNo,
      paymentStatus: sales.paymentStatus,
      model: watches.model,
      brandName: brands.name,
    })
    .from(sales)
    .innerJoin(watches, eq(watches.id, sales.watchId))
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(and(eq(sales.id, saleId), isNull(sales.voidedAt), isNull(sales.deletedAt)))
    .limit(1)

  if (!sale) throw new NotFoundError('Sale')

  const rates = await getRateTable()
  const { feeBase, feeFxRate } = feeInBase(fee.amount, fee.currency, rates)
  const id = newId('brk')

  await withTransaction(async () => {
    await db.update(sales)
      .set({
        voidedAt: new Date(),
        voidedById: actor.id,
        voidReason: 'Recorded as a commission instead',
        updatedAt: new Date(),
      })
      .where(eq(sales.id, saleId))

    await db.insert(brokerages).values({
      id,
      watchId: sale.watchId,
      description: `${sale.brandName} ${sale.model}`,
      soldTo: sale.customerName,
      customerId: sale.customerId,
      brokeredOn: sale.saleDate,
      reference: sale.invoiceNo,
      feeAmount: fee.amount,
      feeCurrency: fee.currency,
      feeFxRate,
      feeBase,
      paymentStatus: sale.paymentStatus,
      soldById: sale.soldById,
      recordedById: actor.id,
    })

    await recordAudit({
      entityType: 'Watch',
      entityId: sale.watchId,
      action: 'UPDATE',
      summary: `${actor.name} re-recorded the sale as a commission`,
      actorId: actor.id,
    })
  })

  await recordAudit({
    entityType: 'Brokerage',
    entityId: id,
    action: 'CREATE',
    summary: `${actor.name} converted invoice ${sale.invoiceNo} to a commission`,
    actorId: actor.id,
  })
  return id
}

/**
 * Watches still on the book, for the commission form's picker.
 *
 * Only what we still hold: something already sold cannot be sold again,
 * and offering it would only produce the conflict the recorder refuses.
 * Labelled the way the stock list labels things, so the piece somebody is
 * looking at on one screen is recognisable on the other.
 */
export async function sellableStock(): Promise<Array<{ id: string; label: string }>> {
  const rows = await db
    .select({
      id: watches.id,
      stockNo: watches.stockNo,
      model: watches.model,
      modelName: watches.modelName,
      brandName: brands.name,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(and(
      inArray(watches.status, ['IN_STOCK', 'RESERVED', 'SALE_AGREED']),
      isNull(watches.deletedAt),
    ))
    .orderBy(desc(watches.stockNo))
    .limit(500)

  return rows.map((row) => ({
    id: row.id,
    label: `${row.stockNo} · ${row.brandName} ${row.modelName ?? row.model}`,
  }))
}

/**
 * Attach a watch to a fee already recorded.
 *
 * The link can only be made at the moment of recording otherwise, and that
 * is the wrong moment to insist on: a fee often gets typed in the hour it
 * arrives and the stock tidied up later. Same guards and same effect as
 * recording it linked — the watch is marked sold, which is what takes it
 * off the shelf and off the website.
 */
export async function linkWatchToBrokerage(
  brokerageId: string,
  watchId: string,
  actor: SessionUser,
): Promise<void> {
  const [fee] = await db.select({ id: brokerages.id, watchId: brokerages.watchId })
    .from(brokerages).where(eq(brokerages.id, brokerageId)).limit(1)
  if (!fee) throw new NotFoundError('Commission')
  if (fee.watchId === watchId) return
  if (fee.watchId) throw new ConflictError('That commission is already linked to a watch.')

  await assertBrokerable(watchId)

  await withTransaction(async () => {
    await db.update(brokerages)
      .set({ watchId, updatedAt: new Date() })
      .where(eq(brokerages.id, brokerageId))
    await db.update(watches)
      .set({ status: 'SOLD', updatedAt: new Date() })
      .where(eq(watches.id, watchId))
    await recordAudit({
      entityType: 'Watch',
      entityId: watchId,
      action: 'SELL',
      summary: `${actor.name} linked it to a commission already recorded`,
      actorId: actor.id,
    })
  })
}
