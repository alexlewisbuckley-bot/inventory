import { and, desc, eq, isNull } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import {
  brands, notifications, partnerCampaigns, partnerOrders, partners, users, watches,
} from '../db/schema'
import { recordAudit } from './audit'
import { newId } from '@/lib/ids'
import { ConflictError, NotFoundError } from '@/lib/errors'
import type { PartnerOrderStatus } from '@/lib/enums'
import type { SessionUser } from '../auth/session'

/**
 * Partner orders, from this side of the counter.
 *
 * A hold never expires on its own — Alex: "If they reserve the watches they
 * should go on hold and we have a way to retract them if payment isn't made
 * manually." So the one thing this side must do well is make the holds
 * visible: a list nobody looks at is how a watch sits off the market for six
 * weeks because a conversation went quiet in March.
 */

export interface HeldRow {
  orderId: string
  watchId: string
  stockNo: number
  brandName: string
  model: string | null
  modelName: string | null
  partnerId: string
  partnerName: string
  placedAt: Date
  placedByName: string | null
  placedByEmail: string | null
  note: string | null
  priceAtOrder: number
  askingAtOrder: number
  discountBpsAtOrder: number
  /** Whether the watch is still actually held, or has moved on beneath us. */
  watchStatus: string
  /** The reward campaign it came from, where it came from one. */
  campaignName: string | null
}

/**
 * What is on hold, for whom, and since when.
 *
 * Ordered oldest first, which is the opposite of nearly every other list in
 * this system. Newest-first is right for things that happened; this is a list
 * of things that have NOT happened, and the one at the top should be the one
 * that has been waiting longest.
 */
export async function listHeldStock(): Promise<HeldRow[]> {
  return db
    .select({
      orderId: partnerOrders.id,
      watchId: watches.id,
      stockNo: watches.stockNo,
      brandName: brands.name,
      model: watches.model,
      modelName: watches.modelName,
      partnerId: partners.id,
      partnerName: partners.name,
      placedAt: partnerOrders.placedAt,
      placedByName: partnerOrders.placedByName,
      placedByEmail: partnerOrders.placedByEmail,
      note: partnerOrders.note,
      priceAtOrder: partnerOrders.priceAtOrder,
      askingAtOrder: partnerOrders.askingAtOrder,
      discountBpsAtOrder: partnerOrders.discountBpsAtOrder,
      watchStatus: watches.status,
      /*
       * The campaign behind it, where there was one.
       *
       * On this list it is the difference between "somebody at the company
       * wants this" and "this is Priya's ten-year award" — which changes how
       * the phone call goes, and is not a thing to make our side guess at.
       */
      campaignName: partnerCampaigns.name,
    })
    .from(partnerOrders)
    .innerJoin(watches, eq(watches.id, partnerOrders.watchId))
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .innerJoin(partners, eq(partners.id, partnerOrders.partnerId))
    .leftJoin(partnerCampaigns, eq(partnerCampaigns.id, partnerOrders.campaignId))
    .where(and(eq(partnerOrders.status, 'PLACED'), isNull(watches.deletedAt)))
    .orderBy(partnerOrders.placedAt)
}

/** Every order for one partner, newest first — this is history, so it reads back. */
export async function listOrdersForPartner(partnerId: string, limit = 50) {
  return db
    .select({
      id: partnerOrders.id,
      status: partnerOrders.status,
      placedAt: partnerOrders.placedAt,
      releasedAt: partnerOrders.releasedAt,
      priceAtOrder: partnerOrders.priceAtOrder,
      stockNo: watches.stockNo,
      brandName: brands.name,
      model: watches.model,
    })
    .from(partnerOrders)
    .innerJoin(watches, eq(watches.id, partnerOrders.watchId))
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(eq(partnerOrders.partnerId, partnerId))
    .orderBy(desc(partnerOrders.placedAt))
    .limit(limit)
}

export async function countHeldStock(): Promise<number> {
  const rows = await listHeldStock()
  return rows.length
}

/**
 * Let a held watch go, by hand.
 *
 * The watch comes back to stock and the order is marked released. Both, in
 * one transaction: a released order over a watch that is still reserved is a
 * piece nobody can sell and nobody can see the reason for, and a watch back
 * in stock under a live order would sell twice.
 *
 * The partner is not told. Alex was explicit about this — the notification
 * goes to our team. A company that has been sitting on a hold for three weeks
 * gets a phone call from somebody here, not an automated email informing them
 * their reservation has lapsed.
 */
export async function releaseHold(
  orderId: string,
  reason: string | null,
  actor: SessionUser,
): Promise<void> {
  await withTransaction(async () => {
    const rows = await db
      .select({
        order: partnerOrders,
        watchId: watches.id,
        stockNo: watches.stockNo,
        status: watches.status,
        version: watches.version,
        partnerName: partners.name,
      })
      .from(partnerOrders)
      .innerJoin(watches, eq(watches.id, partnerOrders.watchId))
      .innerJoin(partners, eq(partners.id, partnerOrders.partnerId))
      .where(eq(partnerOrders.id, orderId))
      .limit(1)

    const row = rows[0]
    if (!row) throw new NotFoundError('Order')
    if (row.order.status !== 'PLACED') {
      throw new ConflictError('That hold has already been dealt with.')
    }

    await db.update(partnerOrders)
      .set({
        status: 'RELEASED',
        releasedAt: new Date(),
        releasedById: actor.id,
        releaseReason: reason?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(partnerOrders.id, orderId))

    /*
     * The watch returns to stock only if it is still where the hold left it.
     *
     * It may have been sold in the meantime through the ordinary flow — which
     * is the happy ending for a hold, not a conflict — and forcing it back to
     * IN_STOCK would un-sell a watch somebody has an invoice for.
     */
    if (row.status === 'RESERVED') {
      await db.update(watches)
        .set({ status: 'IN_STOCK', updatedAt: new Date(), version: row.version + 1 })
        .where(eq(watches.id, row.watchId))

      await recordAudit({
        entityType: 'Watch', entityId: row.watchId, action: 'UPDATE', actorId: actor.id,
        summary: `Stock ${row.stockNo} released from ${row.partnerName}'s hold`,
        changes: { status: { from: 'RESERVED', to: 'IN_STOCK' } },
      })
    }

    await recordAudit({
      entityType: 'PartnerOrder', entityId: orderId, action: 'UPDATE', actorId: actor.id,
      summary: reason?.trim()
        ? `${row.partnerName}: hold on ${row.stockNo} released — ${reason.trim()}`
        : `${row.partnerName}: hold on ${row.stockNo} released`,
    })

    await tellTheTeam({
      title: `Stock ${row.stockNo} is back on the market`,
      body: `${actor.name} released ${row.partnerName}'s hold${reason?.trim() ? ` — ${reason.trim()}` : ''}.`,
      entityId: row.watchId,
      exceptUserId: actor.id,
    })
  })
}

/**
 * Mark an order as having turned into a sale.
 *
 * The sale itself is recorded the ordinary way, against the watch, with an
 * invoice and a buyer. This only closes the order so the hold stops showing
 * as something waiting on somebody.
 */
export async function completeOrder(orderId: string, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const rows = await db
      .select({ order: partnerOrders, stockNo: watches.stockNo, partnerName: partners.name })
      .from(partnerOrders)
      .innerJoin(watches, eq(watches.id, partnerOrders.watchId))
      .innerJoin(partners, eq(partners.id, partnerOrders.partnerId))
      .where(eq(partnerOrders.id, orderId))
      .limit(1)

    const row = rows[0]
    if (!row) throw new NotFoundError('Order')
    if (row.order.status !== 'PLACED') {
      throw new ConflictError('That hold has already been dealt with.')
    }

    await db.update(partnerOrders)
      .set({ status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(partnerOrders.id, orderId))

    await recordAudit({
      entityType: 'PartnerOrder', entityId: orderId, action: 'UPDATE', actorId: actor.id,
      summary: `${row.partnerName}: order for ${row.stockNo} closed as sold`,
    })
  })
}

/** The owner, minus whoever did the thing — nobody needs telling what they just did. */
async function tellTheTeam(notice: {
  title: string
  body: string
  entityId: string
  exceptUserId?: string
}): Promise<void> {
  const people = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'OWNER'), eq(users.isActive, true), isNull(users.deletedAt)))

  for (const person of people) {
    if (person.id === notice.exceptUserId) continue
    await db.insert(notifications).values({
      id: newId('ntf'),
      userId: person.id,
      type: 'PARTNER_ORDER',
      title: notice.title,
      body: notice.body,
      entityType: 'Watch',
      entityId: notice.entityId,
    })
  }
}

export type { PartnerOrderStatus }
