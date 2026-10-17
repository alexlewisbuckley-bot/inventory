import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { liveSale } from '../db/predicates'
import {
  customers, locations, notifications, sales, stockMovements, users, watches,
} from '../db/schema'
import { recordAudit } from './audit'
import { diff } from '@/lib/diff'
import { findWatchById, nextStockNo } from '../repositories/watch-repository'
import { newId } from '@/lib/ids'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { askingPrice, marginPct } from '@/lib/money'
import { can } from '@/lib/permissions'
import { RATE_SCALE, toBase, type RateTable } from '@/lib/currency'
import { getRateTable } from './fx-service'
import { logger } from '@/lib/logger'
import {
  BASE_CURRENCY, PRODUCT_TYPE_NOUNS, WATCH_STATUS_LABELS,
  type CurrencyCode, type WatchStatus,
} from '@/lib/enums'
import type { SessionUser } from '../auth/session'
import type {
  WatchCreateInput, WatchUpdateInput, SaleAmendInput, SaleCreateInput,
} from '@/lib/validation'

/**
 * The rate the entered amount was converted at to reach the stored base,
 * scaled by RATE_SCALE. Kept against the row as provenance, so a later rate
 * correction can be told apart from somebody re-keying the price.
 *
 * This column used to hold the GBP→USD rate. That stopped meaning anything
 * when dollars became the base: the figure it used to convert *to* is now the
 * figure that is stored. Nothing reads the column, so it is redefined here
 * rather than kept alive as a rate between two currencies the system no longer
 * treats as special.
 */
function appliedRate(currency: CurrencyCode, rates: RateTable): number {
  if (currency === BASE_CURRENCY) return RATE_SCALE
  return rates[currency] ?? RATE_SCALE
}

/**
 * Create a watch.
 *
 * The stock number is allocated server-side inside the transaction so two
 * concurrent submissions cannot claim the same one.
 */
export async function createWatch(input: WatchCreateInput, actor: SessionUser): Promise<string> {
  const rates = await getRateTable()

  // What was agreed is stored verbatim; the GBP base is derived from it. Doing
  // it this way round means a later rate correction never rewrites the deal.
  const purchaseMinor = Math.round(input.purchaseAmount * 100)
  const priceGbp = toBase(purchaseMinor, input.purchaseCurrency, rates)
  const estMinor = input.estSaleAmount ? Math.round(Number(input.estSaleAmount) * 100) : null
  // Asking prices sit on the AED 250 ladder. The base is what the shop and
  // every report read, so that is what is snapped.
  const estGbp = askingPrice(estMinor === null ? null : toBase(estMinor, input.estSaleCurrency, rates))
  const tradeMinor = input.tradeAmount ? Math.round(Number(input.tradeAmount) * 100) : null
  const tradeBase = tradeMinor === null ? null : toBase(tradeMinor, input.tradeCurrency, rates)

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
      // The same figure, not a conversion of it: both columns hold base minor
      // units, and the base is dollars. Multiplying here is how a purchase
      // gets booked a third above what was paid.
      purchasePriceUsd: priceGbp,
      purchaseFxRate: appliedRate(input.purchaseCurrency, rates),
      purchaseAmount: purchaseMinor,
      purchaseCurrency: input.purchaseCurrency,
      estSaleGbp: estGbp,
      estSaleAmount: estMinor,
      estSaleCurrency: input.estSaleCurrency,
      // Retained so historic USD exports still reconcile. Same unit as the
      // base column now, so it is copied rather than converted.
      estSaleUsd: estGbp,
      tradePriceGbp: tradeBase,
      tradeAmount: tradeMinor,
      tradeCurrency: input.tradeCurrency,
      locationId: input.locationId,
      ownerId: input.ownerId ?? null,
      caseSizeMm: input.caseSizeMm ?? null,
      caseMaterial: input.caseMaterial ?? null,
      dial: input.dial ?? null,
      bracelet: input.bracelet ?? null,
      movement: input.movement ?? null,
      waterResistanceM: input.waterResistanceM ?? null,
      description: input.description ?? null,

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
  const rates = await getRateTable()

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
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId || null
    // The specification. Written one at a time rather than through a loop, so
    // each field keeps its own type instead of collapsing into whatever the
    // union of them all happens to allow.
    if (input.caseSizeMm !== undefined) patch.caseSizeMm = input.caseSizeMm ?? null
    if (input.caseMaterial !== undefined) patch.caseMaterial = input.caseMaterial || null
    if (input.dial !== undefined) patch.dial = input.dial || null
    if (input.bracelet !== undefined) patch.bracelet = input.bracelet || null
    if (input.movement !== undefined) patch.movement = input.movement || null
    if (input.waterResistanceM !== undefined) patch.waterResistanceM = input.waterResistanceM ?? null
    if (input.description !== undefined) patch.description = input.description || null
    if (input.notes !== undefined) patch.notes = input.notes
    if (input.status !== undefined) patch.status = input.status
    if (input.purchaseDate !== undefined) patch.purchaseDate = input.purchaseDate

    /**
     * Renaming the piece.
     *
     * Refused by name rather than by constraint: the unique index would stop
     * a collision either way, but "duplicate key value violates
     * watches_stock_no_idx" is not a sentence anybody can act on, and the
     * useful fact — which watch is already using it — is one query away.
     *
     * The storefront follows on the next push. Its SKU is this number, and
     * the sync matches a page to a watch by the product id it last pushed
     * to, so the listing is renamed rather than archived and rebuilt.
     */
    if (input.stockNo !== undefined && input.stockNo !== existing.stockNo) {
      const taken = await db.select({ stockNo: watches.stockNo, model: watches.model })
        .from(watches)
        .where(and(eq(watches.stockNo, input.stockNo), isNull(watches.deletedAt)))
        .limit(1)
      if (taken[0]) {
        throw new ConflictError(`Stock number ${input.stockNo} is already ${taken[0].model}.`, {
          stockNo: `Already used by ${taken[0].model}.`,
        })
      }
      patch.stockNo = input.stockNo
    }

    if (input.purchaseAmount !== undefined) {
      const minor = Math.round(input.purchaseAmount * 100)
      patch.purchaseAmount = minor
      patch.purchaseCurrency = input.purchaseCurrency ?? BASE_CURRENCY
      patch.purchasePriceGbp = toBase(minor, patch.purchaseCurrency, rates)
      patch.purchasePriceUsd = patch.purchasePriceGbp
      patch.purchaseFxRate = appliedRate(patch.purchaseCurrency, rates)
    }
    if (input.estSaleAmount !== undefined) {
      const minor = input.estSaleAmount === null ? null : Math.round(Number(input.estSaleAmount) * 100)
      patch.estSaleAmount = minor
      patch.estSaleCurrency = input.estSaleCurrency ?? BASE_CURRENCY
      // Keep the base in step, or every report silently ignores the change.
      patch.estSaleGbp = askingPrice(minor === null ? null : toBase(minor, patch.estSaleCurrency, rates))
      patch.estSaleUsd = patch.estSaleGbp
    }
    if (input.tradeAmount !== undefined) {
      const minor = input.tradeAmount === null ? null : Math.round(Number(input.tradeAmount) * 100)
      patch.tradeAmount = minor
      patch.tradeCurrency = input.tradeCurrency ?? BASE_CURRENCY
      patch.tradePriceGbp = minor === null ? null : toBase(minor, patch.tradeCurrency, rates)
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

    /**
     * A corrected cost has to reach the sale it was sold at.
     *
     * Profit and margin are stored against the sale so reports can total them
     * without joining back to stock. That denormalisation goes stale the
     * moment a cost is corrected after the watch has gone: the ledger keeps
     * reporting the profit it was booked with, and the stock record disagrees
     * with it for good. Every other derived figure in this function is kept in
     * step with the number it comes from; this is the same obligation, one
     * table over.
     */
    if (patch.purchasePriceGbp !== undefined && patch.purchasePriceGbp !== existing.purchasePriceGbp) {
      const liveRows = await db.select().from(sales)
        .where(and(eq(sales.watchId, input.id), liveSale())).limit(1)
      const sale = liveRows[0]
      if (sale) {
        const base = sale.saleAmountGbp
        const profit = base - (patch.purchasePriceGbp as number)
        await db.update(sales).set({
          profitGbp: profit,
          profitUsd: profit,
          marginBps: Math.round((marginPct(patch.purchasePriceGbp as number, base) ?? 0) * 100),
          updatedAt: new Date(),
        }).where(eq(sales.id, sale.id))
      }
    }

    const changes = diff(existing, patch, [
      'stockNo',
      'productType', 'model', 'nickname', 'serial', 'year', 'condition', 'boxPapers', 'brandId',
      'supplierId', 'locationId', 'ownerId', 'notes', 'status', 'purchaseDate', 'purchasePriceGbp', 'estSaleUsd',
      'tradePriceGbp',
      'caseSizeMm', 'caseMaterial', 'dial', 'bracelet', 'movement', 'waterResistanceM', 'description',
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
 *
 * It hands back the buyer as well as the sale, because the form may be holding
 * a photograph of their passport with nowhere to put it until the customer
 * record it belongs to exists.
 */
export async function recordSale(
  input: SaleCreateInput, actor: SessionUser,
): Promise<{ id: string; customerId: string | null }> {
  const rates = await getRateTable()

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
    // figure is preserved exactly as entered; the base is derived from it
    // through the managed rate table and is what every report aggregates. The
    // USD columns are kept only so historic exports still reconcile, and since
    // the base is dollars they now hold the same figure rather than a
    // conversion of it.
    // Cost is taken from the base column rather than the retained USD one, so
    // cost and sale are certainly on the same scale and the profit cannot be a
    // subtraction across two different currencies. Margin comes out of the
    // same helper, in the base, so it agrees with the profit beside it.
    const figures = saleMoney(
      Math.round(input.saleAmount * 100),
      input.saleCurrency,
      appliedRate(input.saleCurrency, rates),
      watch.purchasePriceGbp,
    )
    const saleGbp = figures.saleAmountGbp
    const profitGbp = figures.profitGbp

    const id = newId('sal')
    await db.insert(sales).values({
      id,
      watchId: watch.id,
      invoiceNo: input.invoiceNo,
      saleDate: input.saleDate,
      ...figures,
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
      soldById: input.soldById ?? null,
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
    return { id, customerId }
  })
}

/**
 * The figures a sale carries, worked out from the agreed amount and the cost.
 *
 * Four stored columns and a margin all derive from two numbers, and every one
 * of them is read by a report. Kept in one place so a correction cannot
 * recompute three of them and leave the fourth as it was booked — which is
 * the sort of disagreement nobody notices until a month-end total is out by
 * one watch.
 */
function saleMoney(
  agreedMinor: number,
  currency: CurrencyCode,
  rate: number,
  costBase: number,
): { saleAmount: number; saleAmountGbp: number; saleAmountUsd: number; saleFxRate: number; profitGbp: number; profitUsd: number; marginBps: number } {
  const base = currency === BASE_CURRENCY
    ? agreedMinor
    : Math.round((agreedMinor * RATE_SCALE) / rate)
  const profit = base - costBase
  return {
    saleAmount: agreedMinor,
    saleAmountGbp: base,
    // Held only so historic exports still reconcile. The base is dollars, so
    // this is the same figure rather than a conversion of it.
    saleAmountUsd: base,
    saleFxRate: rate,
    profitGbp: profit,
    profitUsd: profit,
    marginBps: Math.round((marginPct(costBase, base) ?? 0) * 100),
  }
}

/**
 * Correct what was written down about a sale.
 *
 * The invoice number is typed by hand with a customer in the room, and it is
 * the one field that then goes on paper and into their records. Getting it
 * wrong used to mean voiding the sale and booking it again: the row the
 * customer’s invoice points at is discarded, the activity on their timeline
 * is orphaned, and the ledger carries two entries for one watch leaving the
 * building.
 *
 * Profit is recomputed from the watch’s cost as it stands now, not as it
 * stood when the sale was booked. That is deliberate: a cost corrected after
 * the sale leaves a profit figure that is simply wrong, and anybody opening
 * this sale to fix something else is better served by the ledger agreeing
 * with the stock record when they close it.
 */
export async function amendSale(input: SaleAmendInput, actor: SessionUser): Promise<string> {
  const rates = await getRateTable()

  return withTransaction(async () => {
    const saleRows = await db.select().from(sales).where(eq(sales.id, input.id)).limit(1)
    const sale = saleRows[0]
    if (!sale || sale.deletedAt) throw new NotFoundError('Sale')
    // A voided invoice is a record of something that was cancelled. Editing it
    // would rewrite history rather than correct it, and the sale it was
    // replaced by is the row that wants correcting.
    if (sale.voidedAt) {
      throw new ValidationError('This sale has been voided. Correct the sale that replaced it.')
    }

    const watchRows = await db.select().from(watches).where(eq(watches.id, sale.watchId)).limit(1)
    const watch = watchRows[0]
    if (!watch) throw new NotFoundError('Watch')

    // Unique among live sales, excluding this one — otherwise saving a sale
    // without touching its number collides with itself.
    const duplicate = await db.select({ id: sales.id }).from(sales)
      .where(and(eq(sales.invoiceNo, input.invoiceNo), liveSale())).limit(1)
    if (duplicate[0] && duplicate[0].id !== sale.id) {
      throw new ConflictError('That invoice number is already used by another sale.', {
        invoiceNo: 'Invoice number must be unique.',
      })
    }

    /**
     * The rate the sale was booked at, not today’s.
     *
     * A sale agreed in dirhams six months ago has a base figure derived from
     * the rate that applied then. Re-deriving it from the current table would
     * move the recorded revenue by however much the rate has drifted — a
     * change nobody asked for, arriving as a side effect of fixing a typo in
     * an invoice number. Where the currency itself is being corrected there
     * is no booked rate for the new one, so the current table applies and the
     * new rate is stored as the provenance of the figure.
     */
    const rate = input.saleCurrency === sale.saleCurrency && sale.saleFxRate
      ? sale.saleFxRate
      : appliedRate(input.saleCurrency, rates)

    /**
     * The cost, which is the stock record's figure and not the sale's.
     *
     * It is correctable from here because it is printed on this row, beside
     * the profit it produces: somebody looking at a margin they do not
     * believe is looking at these two numbers together, and sending them to
     * another screen to fix one of them is how the margin stays wrong.
     *
     * Two guards. It is only touched when the correction actually names a
     * cost, so a form that does not offer the field cannot blank it. And
     * changing it needs `watch:amend` — the owner-only capability that
     * governs the same figure on the stock list — because `sale:update` is
     * held by Managers, and letting a Manager restate what the business paid
     * by way of the invoice screen would hand them the one thing that
     * capability was carved out to withhold.
     */
    let costBase = watch.purchasePriceGbp
    let costPatch: Record<string, unknown> | null = null
    if (input.purchaseAmount !== null && input.purchaseAmount !== undefined) {
      const currency = input.purchaseCurrency ?? watch.purchaseCurrency ?? BASE_CURRENCY
      // The rate the watch was bought at, for the same reason the sale keeps
      // the rate it was sold at: a cost agreed in dirhams should not move
      // because the rate has since drifted.
      const costRate = currency === watch.purchaseCurrency && watch.purchaseFxRate
        ? watch.purchaseFxRate
        : appliedRate(currency, rates)
      const minor = Math.round(input.purchaseAmount * 100)
      const base = currency === BASE_CURRENCY
        ? minor
        : Math.round((minor * RATE_SCALE) / costRate)

      if (base !== watch.purchasePriceGbp || minor !== watch.purchaseAmount) {
        if (!can(actor.role, 'watch:amend')) {
          throw new ForbiddenError('Changing what a watch cost is the owner’s to do.')
        }
        costBase = base
        costPatch = {
          purchaseAmount: minor,
          purchaseCurrency: currency,
          purchasePriceGbp: base,
          purchasePriceUsd: base,
          purchaseFxRate: costRate,
          updatedAt: new Date(),
          version: watch.version + 1,
        }
      }
    }

    const patch = {
      invoiceNo: input.invoiceNo,
      saleDate: input.saleDate,
      saleCurrency: input.saleCurrency,
      channel: input.channel,
      paymentStatus: input.paymentStatus,
      deliveryStatus: input.deliveryStatus,
      customerName: input.customerName ?? null,
      customerCompany: input.customerCompany ?? null,
      soldById: input.soldById ?? null,
      notes: input.notes ?? null,
      // Against the corrected cost, so the profit on the row agrees with the
      // two figures either side of it the moment the dialog closes.
      ...saleMoney(Math.round(input.saleAmount * 100), input.saleCurrency, rate, costBase),
      updatedAt: new Date(),
    }

    await db.update(sales).set(patch).where(eq(sales.id, sale.id))
    if (costPatch) await db.update(watches).set(costPatch).where(eq(watches.id, watch.id))

    const changes = {
      ...diff(sale, patch, [
        'invoiceNo', 'saleDate', 'saleAmountGbp', 'saleCurrency', 'channel',
        'paymentStatus', 'deliveryStatus', 'customerName', 'customerCompany', 'notes',
        'soldById', 'profitGbp',
      ]),
      // The cost belongs to the watch rather than the sale, and this entry is
      // already written against the watch, so it reads as one event: what the
      // invoice said, what the watch cost, and what the two made.
      ...(costPatch ? diff(watch, costPatch, ['purchasePriceGbp']) : {}),
    }

    // Audited against the watch, which is where the history of this piece is
    // read. A sale has no page of its own to put a trail on.
    await recordAudit({
      entityType: 'Watch', entityId: watch.id, action: 'UPDATE', actorId: actor.id,
      summary: `Sale ${sale.invoiceNo} corrected on stock ${watch.stockNo}`,
      changes,
    })

    logger.info('sale corrected', { saleId: sale.id, watchId: watch.id, actorId: actor.id })
    return watch.id
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
    city: input.buyerCity ?? null,
    addressLine1: input.buyerAddressLine1 ?? null,
    addressLine2: input.buyerAddressLine2 ?? null,
    postcode: input.buyerPostcode ?? null,
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
    // Identification taken at the till, which is where it is obtainable: the
    // document is in the room. Asking for it later means asking somebody who
    // has already left with the watch.
    idKind: input.buyerIdKind,
    idNumber: input.buyerIdNumber ?? null,
    idExpiresOn: input.buyerIdExpiresOn,
    idIssuer: input.buyerIdIssuer ?? null,
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

/**
 * Record that a sale has been paid in full.
 *
 * Deliberately one-way and deliberately narrow: it sets the payment status
 * and nothing else. Anything more — a part payment, a refund, a correction to
 * the figure — is the correction dialog's job, where the whole invoice is in
 * front of somebody.
 *
 * A voided invoice is refused. Money against a sale that was cancelled is a
 * conversation, not a status change.
 */
export async function markSalePaid(saleId: string, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const rows = await db.select().from(sales).where(eq(sales.id, saleId)).limit(1)
    const sale = rows[0]
    if (!sale || sale.deletedAt) throw new NotFoundError('Sale')
    if (sale.voidedAt) {
      throw new ValidationError('That invoice was voided. A payment against it needs looking at rather than ticking off.')
    }
    // Already paid: nothing to write, and no audit entry claiming something
    // happened. Two people clicking the same button is not two payments.
    if (sale.paymentStatus === 'PAID') return

    const watchRows = await db.select({ stockNo: watches.stockNo })
      .from(watches).where(eq(watches.id, sale.watchId)).limit(1)

    await db.update(sales)
      .set({ paymentStatus: 'PAID', updatedAt: new Date() })
      .where(eq(sales.id, saleId))

    await recordAudit({
      entityType: 'Watch', entityId: sale.watchId, action: 'UPDATE', actorId: actor.id,
      summary: `Invoice ${sale.invoiceNo} marked paid in full${watchRows[0] ? ` — stock ${watchRows[0].stockNo}` : ''}`,
      changes: { paymentStatus: { from: sale.paymentStatus, to: 'PAID' } },
    })
  })
}
