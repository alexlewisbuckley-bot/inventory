import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { liveSale } from '../db/predicates'
import {
  appSettings, customers, locations, notifications, sales, stockMovements, users, watches,
} from '../db/schema'
import { recordAudit } from './audit'
import { diff } from '@/lib/diff'
import { findWatchById, nextStockNo } from '../repositories/watch-repository'
import { newId } from '@/lib/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { convert, marginPct } from '@/lib/money'
import { toBase } from '@/lib/currency'
import { getRateTable } from './fx-service'
import { logger } from '@/lib/logger'
import { PRODUCT_TYPE_NOUNS, WATCH_STATUS_LABELS, type WatchStatus } from '@/lib/enums'
import type { SessionUser } from '../auth/session'
import type { WatchCreateInput, WatchUpdateInput, SaleCreateInput } from '@/lib/validation'

/** GBP→USD rate from settings, falling back to the environment default. */
async function fxRate(): Promise<number> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, 'finance.fxGbpUsd')).limit(1)
  const parsed = Number(rows[0]?.value)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return Number(process.env.DEFAULT_FX_GBP_USD ?? 1.33)
}

/**
 * Create a watch.
 *
 * The stock number is allocated server-side inside the transaction so two
 * concurrent submissions cannot claim the same one.
 */
export async function createWatch(input: WatchCreateInput, actor: SessionUser): Promise<string> {
  const [rate, rates] = await Promise.all([fxRate(), getRateTable()])

  // What was agreed is stored verbatim; the GBP base is derived from it. Doing
  // it this way round means a later rate correction never rewrites the deal.
  const purchaseMinor = Math.round(input.purchaseAmount * 100)
  const priceGbp = toBase(purchaseMinor, input.purchaseCurrency, rates)
  const estMinor = input.estSaleAmount ? Math.round(Number(input.estSaleAmount) * 100) : null
  const estGbp = estMinor === null ? null : toBase(estMinor, input.estSaleCurrency, rates)

  return withTransaction(async () => {
    await assertReferencesExist(input.supplierId, input.locationId)

    if (input.serial) {
      const clash = await db.select({ id: watches.id, stockNo: watches.stockNo })
        .from(watches)
        .where(and(eq(watches.serial, input.serial), isNull(watches.deletedAt)))
        .limit(1)
      if (clash[0]) {
        throw new ConflictError(
          `Serial ${input.serial} is already on stock number ${clash[0].stockNo}.`,
          { serial: 'This serial number is already in stock.' },
        )
      }
    }

    const id = newId('wch')
    const stockNo = await nextStockNo()

    await db.insert(watches).values({
      id,
      stockNo,
      productType: input.productType,
      brandId: input.brandId,
      model: input.model,
      nickname: input.nickname ?? null,
      serial: input.serial ?? null,
      year: input.year ?? null,
      condition: input.condition,
      boxPapers: input.boxPapers,
      supplierId: input.supplierId,
      purchaseDate: input.purchaseDate,
      purchasePriceGbp: priceGbp,
      purchasePriceUsd: convert(priceGbp, rate),
      purchaseFxRate: Math.round(rate * 10_000),
      purchaseAmount: purchaseMinor,
      purchaseCurrency: input.purchaseCurrency,
      estSaleGbp: estGbp,
      estSaleAmount: estMinor,
      estSaleCurrency: input.estSaleCurrency,
      // Retained so historic USD exports still reconcile.
      estSaleUsd: estGbp === null ? null : convert(estGbp, rate),
      locationId: input.locationId,
      status: 'IN_STOCK',
      notes: input.notes ?? null,
      createdById: actor.id,
    })

    await db.insert(stockMovements).values({
      id: newId('mov'), watchId: id, fromLocationId: null,
      toLocationId: input.locationId, reason: 'Initial intake', movedById: actor.id,
    })

    await recordAudit({
      entityType: 'Watch', entityId: id, action: 'CREATE', actorId: actor.id,
      summary: `Stock ${stockNo} — ${input.model} added`,
    })

    // Named for what it is: a handbag that arrives unpriced should not tell the
    // team a watch did.
    const noun = PRODUCT_TYPE_NOUNS[input.productType]
    if (estGbp === null) await notifyTeam(
      'PRICE_MISSING',
      `${noun.charAt(0).toUpperCase()}${noun.slice(1)} added without a sale price`,
      `Stock ${stockNo} (${input.model}) needs an estimated sale price.`, 'Watch', id, actor.id,
    )

    logger.info('watch created', { watchId: id, stockNo, actorId: actor.id })
    return id
  })
}

/**
 * Update a watch.
 *
 * `version` implements optimistic concurrency: if another user saved first the
 * write is rejected rather than silently overwriting their change.
 */
export async function updateWatch(input: WatchUpdateInput, actor: SessionUser): Promise<void> {
  const [rate, rates] = await Promise.all([fxRate(), getRateTable()])

  await withTransaction(async () => {
    const rows = await db.select().from(watches).where(eq(watches.id, input.id)).limit(1)
    const existing = rows[0]
    if (!existing || existing.deletedAt) throw new NotFoundError('Watch')

    if (existing.version !== input.version) {
      throw new ConflictError(
        'Someone else changed this watch while you were editing. Reload to see their changes.',
      )
    }

    const patch: Partial<typeof watches.$inferInsert> = {
      updatedAt: new Date(),
      version: existing.version + 1,
    }

    if (input.productType !== undefined) patch.productType = input.productType
    if (input.model !== undefined) patch.model = input.model
    if (input.nickname !== undefined) patch.nickname = input.nickname
    if (input.serial !== undefined) patch.serial = input.serial
    if (input.year !== undefined) patch.year = input.year
    if (input.condition !== undefined) patch.condition = input.condition
    if (input.boxPapers !== undefined) patch.boxPapers = input.boxPapers
    if (input.brandId !== undefined) patch.brandId = input.brandId
    if (input.supplierId !== undefined) patch.supplierId = input.supplierId
    if (input.locationId !== undefined) patch.locationId = input.locationId
    if (input.notes !== undefined) patch.notes = input.notes
    if (input.status !== undefined) patch.status = input.status
    if (input.purchaseDate !== undefined) patch.purchaseDate = input.purchaseDate

    if (input.purchaseAmount !== undefined) {
      const minor = Math.round(input.purchaseAmount * 100)
      patch.purchaseAmount = minor
      patch.purchaseCurrency = input.purchaseCurrency ?? 'GBP'
      patch.purchasePriceGbp = toBase(minor, patch.purchaseCurrency, rates)
      patch.purchasePriceUsd = convert(patch.purchasePriceGbp, rate)
      patch.purchaseFxRate = Math.round(rate * 10_000)
    }
    if (input.estSaleAmount !== undefined) {
      const minor = input.estSaleAmount === null ? null : Math.round(Number(input.estSaleAmount) * 100)
      patch.estSaleAmount = minor
      patch.estSaleCurrency = input.estSaleCurrency ?? 'GBP'
      // Keep the GBP base in step, or every report silently ignores the change.
      patch.estSaleGbp = minor === null ? null : toBase(minor, patch.estSaleCurrency, rates)
      patch.estSaleUsd = patch.estSaleGbp === null ? null : convert(patch.estSaleGbp, rate)
    }

    // A location change is a stock movement in its own right, not just a field edit.
    if (patch.locationId && patch.locationId !== existing.locationId) {
      await db.insert(stockMovements).values({
        id: newId('mov'), watchId: existing.id,
        fromLocationId: existing.locationId, toLocationId: patch.locationId,
        reason: 'Updated via edit form', movedById: actor.id,
      })
    }

    await db.update(watches).set(patch).where(eq(watches.id, input.id))

    const changes = diff(existing, patch, [
      'productType', 'model', 'nickname', 'serial', 'year', 'condition', 'boxPapers', 'brandId',
      'supplierId', 'locationId', 'notes', 'status', 'purchaseDate', 'purchasePriceGbp', 'estSaleUsd',
    ])

    await recordAudit({
      entityType: 'Watch', entityId: input.id, action: 'UPDATE', actorId: actor.id,
      summary: `Stock ${existing.stockNo} updated`, changes,
    })
  })
}

/** Move one or more watches to a new location, logging each transfer. */
export async function moveWatches(
  watchIds: string[], toLocationId: string, reason: string | null, actor: SessionUser,
): Promise<number> {
  return withTransaction(async () => {
    const destination = await db.select().from(locations)
      .where(and(eq(locations.id, toLocationId), isNull(locations.deletedAt))).limit(1)
    if (!destination[0]) throw new NotFoundError('Location')

    const targets = await db.select().from(watches)
      .where(and(inArray(watches.id, watchIds), isNull(watches.deletedAt)))
    if (targets.length === 0) throw new NotFoundError('Watch')

    let moved = 0
    for (const watch of targets) {
      if (watch.locationId === toLocationId) continue
      if (watch.status === 'SOLD') {
        throw new ValidationError(`Stock ${watch.stockNo} has been sold and cannot be moved.`)
      }

      await db.update(watches)
        .set({ locationId: toLocationId, updatedAt: new Date(), version: watch.version + 1 })
        .where(eq(watches.id, watch.id))
      await db.insert(stockMovements).values({
        id: newId('mov'), watchId: watch.id, fromLocationId: watch.locationId,
        toLocationId, reason, movedById: actor.id,
      })
      await recordAudit({
        entityType: 'Watch', entityId: watch.id, action: 'MOVE', actorId: actor.id,
        summary: `Stock ${watch.stockNo} moved to ${destination[0].name}`,
        changes: { locationId: { from: watch.locationId, to: toLocationId } },
      })
      moved += 1
    }

    logger.info('watches moved', { count: moved, toLocationId, actorId: actor.id })
    return moved
  })
}

/**
 * Record a sale.
 *
 * Writes the sale, flips the watch to SOLD and appends the audit entry in one
 * transaction — a half-applied sale would corrupt every profit report.
 */
export async function recordSale(input: SaleCreateInput, actor: SessionUser): Promise<string> {
  const [rate, rates] = await Promise.all([fxRate(), getRateTable()])

  return withTransaction(async () => {
    const rows = await db.select().from(watches).where(eq(watches.id, input.watchId)).limit(1)
    const watch = rows[0]
    if (!watch || watch.deletedAt) throw new NotFoundError('Watch')
    if (watch.status === 'SOLD') throw new ConflictError('This watch has already been sold.')

    // A buyer typed into the sale form becomes a customer record, not a string
    // stranded on one row. Recording who bought a watch and being unable to
    // find them again is the failure the customer book exists to prevent.
    const customerId = await resolveBuyer(input, actor)

    // Voided invoices free their number: the commonest reason to void is
    // having booked the sale against the wrong watch, and the invoice the
    // customer is holding has not changed.
    const duplicate = await db.select({ id: sales.id }).from(sales)
      .where(and(eq(sales.invoiceNo, input.invoiceNo), liveSale())).limit(1)
    if (duplicate[0]) {
      throw new ConflictError('That invoice number has already been used.', {
        invoiceNo: 'Invoice number must be unique.',
      })
    }

    // The sale is agreed in one currency and reported in another. The agreed
    // figure is preserved exactly as entered; GBP is derived from it through
    // the managed rate table and is what every report aggregates. USD is kept
    // only so historic exports still reconcile.
    const saleMinor = Math.round(input.saleAmount * 100)
    const saleGbp = toBase(saleMinor, input.saleCurrency, rates)
    const saleUsd = convert(saleGbp, rate)
    const costUsd = watch.purchasePriceUsd ?? convert(watch.purchasePriceGbp, rate)
    const profitUsd = saleUsd - costUsd
    const profitGbp = saleGbp - watch.purchasePriceGbp
    // Margin is taken in GBP so it agrees with the profit figure beside it.
    const margin = marginPct(watch.purchasePriceGbp, saleGbp) ?? 0

    const id = newId('sal')
    await db.insert(sales).values({
      id,
      watchId: watch.id,
      invoiceNo: input.invoiceNo,
      saleDate: input.saleDate,
      saleAmountUsd: saleUsd,
      saleAmountGbp: saleGbp,
      saleFxRate: Math.round(rate * 10_000),
      saleAmount: saleMinor,
      saleCurrency: input.saleCurrency,
      customerName: input.customerName ?? null,
      customerCompany: input.customerCompany ?? null,
      customerEmail: input.customerEmail ?? null,
      customerPhone: input.customerPhone ?? null,
      customerCountry: input.customerCountry ?? null,
      customerId,
      dealId: input.dealId ?? null,
      paymentStatus: input.paymentStatus,
      deliveryStatus: input.deliveryStatus,
      depositGbp: input.depositGbp ?? 0,
      channel: input.channel,
      profitUsd,
      profitGbp,
      marginBps: Math.round(margin * 100),
      notes: input.notes ?? null,
      recordedById: actor.id,
    })

    await db.update(watches)
      .set({ status: 'SOLD', updatedAt: new Date(), version: watch.version + 1 })
      .where(eq(watches.id, watch.id))

    await recordAudit({
      entityType: 'Watch', entityId: watch.id, action: 'SELL', actorId: actor.id,
      summary: `Stock ${watch.stockNo} sold on invoice ${input.invoiceNo}`,
      changes: { status: { from: watch.status, to: 'SOLD' } },
    })

    await notifyTeam('SALE_RECORDED', 'Sale recorded',
      `Stock ${watch.stockNo} (${watch.model}) sold for £${(saleGbp / 100).toLocaleString()}.`,
      'Watch', watch.id, actor.id)

    // The CRM half of a sale. A watch leaving the building is the single most
    // important thing that ever happens to a relationship, so it is written on
    // to the customer's timeline here rather than being reconstructed later
    // from the ledger — and the deal it came from is closed in the same breath,
    // because nobody remembers to go back to the board afterwards.
    if (customerId) {
      const { logActivity } = await import('./crm-service')
      await logActivity({
        type: 'SALE',
        subject: `Bought stock ${watch.stockNo}`,
        body: `${watch.model} on invoice ${input.invoiceNo}.`,
        isSystem: true,
        scope: { customerId, watchId: watch.id, dealId: input.dealId },
        actorId: actor.id,
      })
    }

    if (input.dealId) {
      const { moveDeal } = await import('./crm-service')
      await moveDeal(input.dealId, 'WON', actor).catch((error) => {
        // A deal that cannot be closed must not roll back a recorded sale: the
        // money is the fact, the board is the view of it.
        logger.warn('sale recorded but deal not closed', {
          dealId: input.dealId, error: (error as Error).message,
        })
      })
    }

    logger.info('sale recorded', { saleId: id, watchId: watch.id, profitGbp })
    return id
  })
}


/**
 * The customer this sale belongs to.
 *
 * Three ways in, in order of confidence: an explicit pick from the book; an
 * email that already belongs to somebody, which quietly reuses them rather
 * than creating a second record for the same person; and finally a new record
 * built from what was typed. A sale with no buyer details at all — the cash
 * walk-in — is still allowed and returns null.
 */
async function resolveBuyer(input: SaleCreateInput, actor: SessionUser): Promise<string | null> {
  if (input.customerId) return input.customerId

  const first = input.buyerFirstName?.trim()
  const last = input.buyerLastName?.trim()
  if (!first && !last && !input.customerEmail) return null

  if (input.customerEmail) {
    const existing = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.email, input.customerEmail), isNull(customers.deletedAt)))
      .limit(1)
    if (existing[0]) return existing[0].id
  }

  if (!first && !last) return null

  const { createCustomer } = await import('./crm-service')
  return createCustomer({
    // A single name goes in the surname, which is how a dealer would file it.
    firstName: first || last!,
    lastName: first ? (last ?? '') || first : last!,
    company: input.customerCompany ?? null,
    email: input.customerEmail ?? null,
    phone: input.customerPhone ?? null,
    altPhone: null,
    country: input.buyerCountry ?? input.customerCountry ?? null,
    city: null,
    addressLine1: null,
    addressLine2: null,
    postcode: null,
    preferredChannel: 'EMAIL',
    tier: input.buyerTier,
    customerType: input.buyerType,
    status: 'ACTIVE',
    // Trade paperwork is not asked for mid-sale; it is filled in on the record
    // when somebody actually needs to raise an invoice against terms.
    paymentTerms: 'UNKNOWN',
    creditLimitGbp: null,
    vatNo: null,
    registrationNo: null,
    supplierId: null,
    leadSource: input.buyerLeadSource,
    budgetMinGbp: null,
    budgetMaxGbp: null,
    birthday: null,
    notes: null,
    riskNotes: null,
    marketingConsent: false,
    ownerId: actor.id,
    brandIds: [],
  }, actor)
}

/**
 * Which statuses a watch can move to from where it is now.
 *
 * SOLD is deliberately absent from every list: reaching it requires a sale
 * record — an invoice, an amount, a buyer — so it is set by recordSale and
 * left by voidSale, never by picking it from a menu. Leaving it selectable
 * would let someone mark a watch sold with no money attached to it, which is
 * exactly the hole that made the sales figures untrustworthy in the
 * spreadsheet this replaced.
 */
export const STATUS_TRANSITIONS: Record<WatchStatus, WatchStatus[]> = {
  IN_STOCK: ['RESERVED', 'SALE_AGREED', 'WRITTEN_OFF'],
  RESERVED: ['IN_STOCK', 'SALE_AGREED', 'WRITTEN_OFF'],
  SALE_AGREED: ['IN_STOCK', 'RESERVED', 'WRITTEN_OFF'],
  SOLD: [],
  RETURNED: ['IN_STOCK', 'WRITTEN_OFF'],
  WRITTEN_OFF: ['IN_STOCK'],
}

/**
 * Move a watch between the states that do not involve money changing hands.
 *
 * Every change is a stock event in its own right, so it is audited with both
 * the old and new value rather than overwriting the field silently.
 */
export async function setWatchStatus(
  id: string,
  status: WatchStatus,
  actor: SessionUser,
): Promise<void> {
  await withTransaction(async () => {
    const rows = await db.select().from(watches).where(eq(watches.id, id)).limit(1)
    const watch = rows[0]
    if (!watch || watch.deletedAt) throw new NotFoundError('Watch')
    if (watch.status === status) return

    const allowed = STATUS_TRANSITIONS[watch.status as WatchStatus] ?? []
    if (!allowed.includes(status)) {
      throw new ValidationError(
        watch.status === 'SOLD'
          ? 'This watch is sold. Void the sale first to bring it back into stock.'
          : `A watch cannot go straight from ${WATCH_STATUS_LABELS[watch.status as WatchStatus].toLowerCase()} to ${WATCH_STATUS_LABELS[status].toLowerCase()}.`,
      )
    }

    await db.update(watches)
      .set({ status, updatedAt: new Date(), version: watch.version + 1 })
      .where(eq(watches.id, id))

    await recordAudit({
      entityType: 'Watch', entityId: id, action: 'UPDATE', actorId: actor.id,
      summary: `Stock ${watch.stockNo} marked ${WATCH_STATUS_LABELS[status].toLowerCase()}`,
      changes: { status: { from: watch.status, to: status } },
    })
  })
}

/**
 * Void a sale and bring the watch back into stock.
 *
 * The sale row is kept and marked void rather than deleted: an invoice that
 * was issued and then cancelled is a thing that happened, and every margin
 * report that has already been read needs to remain explicable. Reports filter
 * voided rows out, so the figures move as if the sale never completed while
 * the trail of what was corrected survives.
 */
export async function voidSale(
  watchId: string,
  reason: string | null,
  actor: SessionUser,
): Promise<void> {
  await withTransaction(async () => {
    const rows = await db.select().from(watches).where(eq(watches.id, watchId)).limit(1)
    const watch = rows[0]
    if (!watch) throw new NotFoundError('Watch')
    if (watch.status !== 'SOLD') {
      throw new ValidationError('This watch is not marked as sold.')
    }

    const saleRows = await db.select().from(sales)
      .where(and(eq(sales.watchId, watchId), isNull(sales.deletedAt), isNull(sales.voidedAt)))
      .limit(1)
    const sale = saleRows[0]
    if (!sale) {
      throw new ValidationError('No live sale was found against this watch.')
    }

    await db.update(sales)
      .set({ voidedAt: new Date(), voidedById: actor.id, voidReason: reason })
      .where(eq(sales.id, sale.id))

    await db.update(watches)
      .set({ status: 'IN_STOCK', updatedAt: new Date(), version: watch.version + 1 })
      .where(eq(watches.id, watchId))

    await recordAudit({
      entityType: 'Watch', entityId: watchId, action: 'UPDATE', actorId: actor.id,
      summary: `Sale ${sale.invoiceNo} voided — stock ${watch.stockNo} returned to stock`,
      changes: { status: { from: 'SOLD', to: 'IN_STOCK' } },
    })

    logger.info('sale voided', { saleId: sale.id, watchId, actorId: actor.id })
  })
}

/** Soft-delete. The record stays queryable for audit and can be restored. */
export async function deleteWatch(id: string, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const rows = await db.select().from(watches).where(eq(watches.id, id)).limit(1)
    const watch = rows[0]
    if (!watch || watch.deletedAt) throw new NotFoundError('Watch')
    if (watch.status === 'SOLD') {
      throw new ValidationError('Sold watches cannot be deleted — they are part of the sales record.')
    }

    await db.update(watches)
      .set({ deletedAt: new Date(), updatedAt: new Date(), version: watch.version + 1 })
      .where(eq(watches.id, id))
    await recordAudit({
      entityType: 'Watch', entityId: id, action: 'DELETE', actorId: actor.id,
      summary: `Stock ${watch.stockNo} deleted`,
    })
  })
}

export async function restoreWatch(id: string, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const rows = await db.select().from(watches).where(eq(watches.id, id)).limit(1)
    const watch = rows[0]
    if (!watch) throw new NotFoundError('Watch')

    await db.update(watches)
      .set({ deletedAt: null, updatedAt: new Date(), version: watch.version + 1 })
      .where(eq(watches.id, id))
    await recordAudit({
      entityType: 'Watch', entityId: id, action: 'RESTORE', actorId: actor.id,
      summary: `Stock ${watch.stockNo} restored`,
    })
  })
}

export async function getWatchDetail(id: string) {
  const record = await findWatchById(id)
  if (!record) throw new NotFoundError('Watch')
  return record
}

async function assertReferencesExist(supplierId: string, locationId: string): Promise<void> {
  const [location] = await db.select({ id: locations.id }).from(locations)
    .where(and(eq(locations.id, locationId), isNull(locations.deletedAt))).limit(1)
  if (!location) throw new ValidationError('That location no longer exists.', { locationId: 'Choose a valid location.' })
  void supplierId
}

/** Fan a notification out to every active user except the actor. */
async function notifyTeam(
  type: 'PRICE_MISSING' | 'SALE_RECORDED' | 'STOCK_ADDED' | 'WATCH_MOVED',
  title: string, body: string, entityType: string, entityId: string, actorId: string,
): Promise<void> {
  const recipients = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.isActive, true), isNull(users.deletedAt)))
  for (const recipient of recipients) {
    if (recipient.id === actorId) continue
    await db.insert(notifications).values({
      id: newId('ntf'), userId: recipient.id, type, title, body, entityType, entityId,
    })
  }
}
