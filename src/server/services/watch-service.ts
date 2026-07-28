import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { appSettings, locations, notifications, sales, stockMovements, users, watches } from '../db/schema'
import { recordAudit } from './audit'
import { diff } from '@/lib/diff'
import { findWatchById, nextStockNo } from '../repositories/watch-repository'
import { newId } from '@/lib/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { convert, marginPct } from '@/lib/money'
import { logger } from '@/lib/logger'
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
  const rate = await fxRate()
  const priceGbp = Math.round(input.purchasePriceGbp * 100)
  const estSale = input.estSaleUsd ? Math.round(Number(input.estSaleUsd) * 100) : null

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
      purchaseAmount: priceGbp,
      purchaseCurrency: 'GBP',
      estSaleUsd: estSale,
      // The estimate is quoted in USD today; the GBP base is what reports use.
      estSaleAmount: estSale,
      estSaleCurrency: 'USD',
      estSaleGbp: estSale === null ? null : Math.round(estSale / rate),
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

    if (!estSale) await notifyTeam('PRICE_MISSING', 'Watch added without a sale price',
      `Stock ${stockNo} (${input.model}) needs an estimated sale price.`, 'Watch', id, actor.id)

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
  const rate = await fxRate()

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

    if (input.purchasePriceGbp !== undefined) {
      patch.purchasePriceGbp = Math.round(input.purchasePriceGbp * 100)
      patch.purchasePriceUsd = convert(patch.purchasePriceGbp, rate)
      patch.purchaseFxRate = Math.round(rate * 10_000)
      patch.purchaseAmount = patch.purchasePriceGbp
      patch.purchaseCurrency = 'GBP'
    }
    if (input.estSaleUsd !== undefined) {
      const estimate = input.estSaleUsd === null ? null : Math.round(Number(input.estSaleUsd) * 100)
      patch.estSaleUsd = estimate
      patch.estSaleAmount = estimate
      patch.estSaleCurrency = 'USD'
      // Keep the GBP base in step, or every report silently ignores the change.
      patch.estSaleGbp = estimate === null ? null : Math.round(estimate / rate)
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
      'model', 'nickname', 'serial', 'year', 'condition', 'boxPapers', 'brandId',
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
  const rate = await fxRate()

  return withTransaction(async () => {
    const rows = await db.select().from(watches).where(eq(watches.id, input.watchId)).limit(1)
    const watch = rows[0]
    if (!watch || watch.deletedAt) throw new NotFoundError('Watch')
    if (watch.status === 'SOLD') throw new ConflictError('This watch has already been sold.')

    const duplicate = await db.select({ id: sales.id }).from(sales)
      .where(eq(sales.invoiceNo, input.invoiceNo)).limit(1)
    if (duplicate[0]) {
      throw new ConflictError('That invoice number has already been used.', {
        invoiceNo: 'Invoice number must be unique.',
      })
    }

    const saleUsd = Math.round(input.saleAmountUsd * 100)
    const saleGbp = Math.round(saleUsd / rate)
    const costUsd = watch.purchasePriceUsd ?? convert(watch.purchasePriceGbp, rate)
    const profitUsd = saleUsd - costUsd
    const profitGbp = saleGbp - watch.purchasePriceGbp
    const margin = marginPct(costUsd, saleUsd) ?? 0

    const id = newId('sal')
    await db.insert(sales).values({
      id,
      watchId: watch.id,
      invoiceNo: input.invoiceNo,
      saleDate: input.saleDate,
      saleAmountUsd: saleUsd,
      saleAmountGbp: saleGbp,
      saleFxRate: Math.round(rate * 10_000),
      saleAmount: saleUsd,
      saleCurrency: 'USD',
      customerName: input.customerName ?? null,
      customerEmail: input.customerEmail ?? null,
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
      `Stock ${watch.stockNo} (${watch.model}) sold for $${(saleUsd / 100).toLocaleString()}.`,
      'Watch', watch.id, actor.id)

    logger.info('sale recorded', { saleId: id, watchId: watch.id, profitUsd })
    return id
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
