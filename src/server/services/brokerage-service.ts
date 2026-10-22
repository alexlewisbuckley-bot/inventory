import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { brokerages, salesPeople } from '../db/schema'
import { newId } from '@/lib/ids'
import { recordAudit } from './audit'
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

  await db.insert(brokerages).values({
    id,
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

  await recordAudit({
    entityType: 'Brokerage',
    entityId: id,
    action: 'CREATE',
    summary: `${actor.name} recorded a commission on ${input.description}`,
    actorId: actor.id,
  })
  return id
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
    })
    .from(brokerages)
    .leftJoin(salesPeople, eq(salesPeople.id, brokerages.soldById))
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
