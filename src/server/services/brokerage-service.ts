import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { brands, brokerages, sales, salesPeople, watches } from '../db/schema'
import { newId } from '@/lib/ids'
import { recordAudit } from './audit'
import { ConflictError, NotFoundError } from '@/lib/errors'
import { getRateTable } from './fx-service'
import { BASE_CURRENCY, type CurrencyCode } from '@/lib/enums'
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
  const [ledger, fees] = await Promise.all([
    salesByPerson(from, to, onlyPersonId),
    brokerageByPersonDetailed(from, to, onlyPersonId),
  ])

  const rows = ledger.map((row) => ({
    ...row,
    soldCount: Number(row.soldCount),
    revenueGbp: Number(row.revenueGbp),
    profitGbp: Number(row.profitGbp),
    costGbp: Number(row.costGbp),
    /** Profit on their own stock, which is what a margin is measured on. */
    stockProfitGbp: Number(row.profitGbp),
  }))
  const byId = new Map(rows.map((row) => [row.personId ?? 'none', row]))

  for (const fee of fees) {
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
    // Somebody whose only earnings this period were brokered. Without this
    // they would be missing from a report that is meant to list everybody.
    const row = {
      personId: fee.personId,
      personName: fee.personName ?? 'Not recorded',
      soldCount: fee.count,
      revenueGbp: fee.total,
      profitGbp: fee.total,
      costGbp: 0,
      stockProfitGbp: 0,
      lastSaleAt: fee.lastAt,
    }
    rows.push(row as typeof rows[number])
    byId.set(key, row as typeof rows[number])
  }

  return rows
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
      nickname: watches.nickname,
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
    label: `${row.stockNo} · ${row.brandName} ${row.nickname ?? row.model}`,
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
