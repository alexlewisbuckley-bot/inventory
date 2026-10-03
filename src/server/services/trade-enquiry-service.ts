import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, withTransaction } from '../db/client'
import {
  brands, deals, notifications, tradeEnquiries, tradeMessages, users, watches,
} from '../db/schema'
import { recordAudit } from './audit'
import { createDeal } from './crm-service'
import { sendWhatsApp } from './whatsapp'
import { newId } from '@/lib/ids'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { formatBase } from '@/lib/currency'
import { BASE_CURRENCY, TRADE_ENQUIRY_KIND_LABELS, type TradeEnquiryKind } from '@/lib/enums'
import type { SessionUser } from '../auth/session'

/**
 * Trade enquiries: a dealer asking, and somebody answering.
 *
 * The whole point of the shape is the gap between the two. A dealer pressing a
 * button does not put a deal on the board — approving it does, and approving
 * is the owner's. What a dealer gets is a conversation and an answer.
 */

/** Who hears about an enquiry. The owner, and for now only the owner. */
async function owners() {
  return db
    .select({ id: users.id, name: users.name, phone: users.phone })
    .from(users)
    .where(and(eq(users.role, 'OWNER'), eq(users.isActive, true), isNull(users.deletedAt)))
}

/**
 * Tell somebody, in the application and on their phone.
 *
 * The notification is written first and the relay is attempted after, and the
 * relay failing is recorded rather than thrown: an enquiry that exists only if
 * WhatsApp was reachable is an enquiry that goes missing on the day it
 * matters. Everything here is already in the database by the time this runs.
 */
async function tell(
  people: Array<{ id: string; phone: string | null }>,
  notice: { title: string; body: string; entityId: string },
) {
  for (const person of people) {
    await db.insert(notifications).values({
      id: newId('ntf'),
      userId: person.id,
      type: 'TRADE_ENQUIRY',
      title: notice.title,
      body: notice.body,
      entityType: 'TradeEnquiry',
      entityId: notice.entityId,
    })
  }
  for (const person of people) {
    if (!person.phone) continue
    const result = await sendWhatsApp(person.phone, `${notice.title}\n${notice.body}`)
    if (!result.sent) logger.info('trade enquiry not relayed', { note: result.note })
  }
}

export interface RaiseEnquiryInput {
  watchId: string
  kind: TradeEnquiryKind
  offerGbp: number | null
  message: string | null
}

/** A dealer, on the catalogue, saying they want something. */
export async function raiseEnquiry(input: RaiseEnquiryInput, actor: SessionUser): Promise<string> {
  return withTransaction(async () => {
    const [watch] = await db
      .select({ id: watches.id, stockNo: watches.stockNo, model: watches.model, brandName: brands.name })
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(and(eq(watches.id, input.watchId), isNull(watches.deletedAt)))
      .limit(1)
    if (!watch) throw new NotFoundError('Watch')

    // One open enquiry per dealer per watch. Pressing the button twice is a
    // dealer wondering whether the first one worked, not a second enquiry.
    const [existing] = await db.select({ id: tradeEnquiries.id })
      .from(tradeEnquiries)
      .where(and(
        eq(tradeEnquiries.watchId, input.watchId),
        eq(tradeEnquiries.traderId, actor.id),
        eq(tradeEnquiries.status, 'OPEN'),
      ))
      .limit(1)
    if (existing) {
      if (input.message) await addMessage(existing.id, input.message, actor)
      return existing.id
    }

    const subject = `${watch.brandName} ${watch.model} · stock ${watch.stockNo}`
    const id = newId('tre')
    await db.insert(tradeEnquiries).values({
      id,
      watchId: watch.id,
      subject,
      traderId: actor.id,
      kind: input.kind,
      offerGbp: input.offerGbp,
      status: 'OPEN',
      // The person raising it has, by definition, read it.
      traderReadAt: new Date(),
    })

    if (input.message) {
      await db.insert(tradeMessages).values({
        id: newId('trm'), enquiryId: id, authorId: actor.id, body: input.message,
      })
    }

    await recordAudit({
      entityType: 'Customer', entityId: id, action: 'CREATE', actorId: actor.id,
      summary: `${actor.name} enquired about ${subject}`,
    })

    const offer = input.offerGbp !== null
      ? ` at ${formatBase(input.offerGbp, BASE_CURRENCY, {})}`
      : ''
    await tell(await owners(), {
      title: `${actor.name}: ${TRADE_ENQUIRY_KIND_LABELS[input.kind].toLowerCase()}`,
      body: `${subject}${offer}${input.message ? ` — "${input.message}"` : ''}`,
      entityId: id,
    })
    return id
  })
}

/** A line in the thread, from either side. */
export async function addMessage(enquiryId: string, body: string, actor: SessionUser): Promise<void> {
  const text = body.trim()
  if (!text) throw new ValidationError('Write something first.')

  await withTransaction(async () => {
    const [enquiry] = await db.select().from(tradeEnquiries)
      .where(eq(tradeEnquiries.id, enquiryId)).limit(1)
    if (!enquiry) throw new NotFoundError('Enquiry')

    const fromTrader = enquiry.traderId === actor.id
    await db.insert(tradeMessages).values({
      id: newId('trm'), enquiryId, authorId: actor.id, body: text,
    })
    await db.update(tradeEnquiries).set({
      updatedAt: new Date(),
      // Writing is reading. Marking only the other side unread is what makes
      // the count mean "waiting on you" rather than "has activity".
      ...(fromTrader ? { traderReadAt: new Date() } : { staffReadAt: new Date() }),
    }).where(eq(tradeEnquiries.id, enquiryId))

    if (fromTrader) {
      await tell(await owners(), {
        title: `${actor.name} replied`,
        body: `${enquiry.subject} — "${text}"`,
        entityId: enquiryId,
      })
    } else {
      const [trader] = await db.select({ id: users.id, phone: users.phone })
        .from(users).where(eq(users.id, enquiry.traderId)).limit(1)
      if (trader) {
        await tell([trader], {
          title: 'One Street Watches replied',
          body: `${enquiry.subject} — "${text}"`,
          entityId: enquiryId,
        })
      }
    }
  })
}

/**
 * The answer.
 *
 * Approving is the only thing in this file that creates a deal, which is the
 * gate the whole shape exists for: a dealer can ask, and only an owner can
 * turn asking into something on the board.
 */
export async function decideEnquiry(
  enquiryId: string,
  decision: 'APPROVED' | 'DECLINED',
  note: string | null,
  actor: SessionUser,
): Promise<{ dealId: string | null }> {
  return withTransaction(async () => {
    const [enquiry] = await db.select().from(tradeEnquiries)
      .where(eq(tradeEnquiries.id, enquiryId)).limit(1)
    if (!enquiry) throw new NotFoundError('Enquiry')
    if (enquiry.status !== 'OPEN') {
      throw new ValidationError('That enquiry has already been answered.')
    }

    let dealId: string | null = null
    if (decision === 'APPROVED') {
      const [trader] = await db.select({ name: users.name }).from(users)
        .where(eq(users.id, enquiry.traderId)).limit(1)
      dealId = await createDeal({
        title: enquiry.subject,
        customerId: null,
        watchId: enquiry.watchId,
        stage: 'QUALIFIED',
        valueGbp: enquiry.offerGbp,
        depositGbp: null,
        expectedClose: null,
        ownerId: actor.id,
        source: 'TRADE',
        notes: `Opened from a trade enquiry by ${trader?.name ?? 'a trade partner'}.`,
      }, actor)
    }

    await db.update(tradeEnquiries).set({
      status: decision,
      dealId,
      decidedAt: new Date(),
      decidedById: actor.id,
      staffReadAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(tradeEnquiries.id, enquiryId))

    if (note) {
      await db.insert(tradeMessages).values({
        id: newId('trm'), enquiryId, authorId: actor.id, body: note,
      })
    }

    await recordAudit({
      entityType: 'Deal', entityId: dealId ?? enquiryId, action: 'UPDATE', actorId: actor.id,
      summary: decision === 'APPROVED'
        ? `Trade enquiry approved: ${enquiry.subject}`
        : `Trade enquiry declined: ${enquiry.subject}`,
    })

    const [trader] = await db.select({ id: users.id, phone: users.phone })
      .from(users).where(eq(users.id, enquiry.traderId)).limit(1)
    if (trader) {
      await tell([trader], {
        title: decision === 'APPROVED' ? 'Your enquiry was accepted' : 'Your enquiry was declined',
        body: `${enquiry.subject}${note ? ` — "${note}"` : ''}`,
        entityId: enquiryId,
      })
    }
    return { dealId }
  })
}

export interface EnquiryRow {
  id: string
  subject: string
  kind: string
  offerGbp: number | null
  status: string
  traderName: string | null
  watchId: string | null
  dealId: string | null
  messages: number
  unread: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * The list, scoped to who is asking.
 *
 * A trade partner sees their own and nothing else — the same rule as the
 * catalogue, where the whole role exists behind one capability.
 */
export async function listEnquiries(actor: SessionUser): Promise<EnquiryRow[]> {
  const trader = alias(users, 'enquiry_trader')
  const mine = actor.role === 'TRADER'
  const rows = await db
    .select({
      id: tradeEnquiries.id,
      subject: tradeEnquiries.subject,
      kind: tradeEnquiries.kind,
      offerGbp: tradeEnquiries.offerGbp,
      status: tradeEnquiries.status,
      traderName: trader.name,
      watchId: tradeEnquiries.watchId,
      dealId: tradeEnquiries.dealId,
      createdAt: tradeEnquiries.createdAt,
      updatedAt: tradeEnquiries.updatedAt,
      traderReadAt: tradeEnquiries.traderReadAt,
      staffReadAt: tradeEnquiries.staffReadAt,
      messages: sql<number>`(
        select count(*)::int from ${tradeMessages} where ${tradeMessages.enquiryId} = ${tradeEnquiries.id}
      )`,
      lastAt: sql<Date | null>`(
        select max(created_at) from ${tradeMessages} where ${tradeMessages.enquiryId} = ${tradeEnquiries.id}
      )`,
    })
    .from(tradeEnquiries)
    .leftJoin(trader, eq(trader.id, tradeEnquiries.traderId))
    .where(mine ? eq(tradeEnquiries.traderId, actor.id) : undefined)
    .orderBy(desc(tradeEnquiries.updatedAt))

  return rows.map((row) => {
    const seen = mine ? row.traderReadAt : row.staffReadAt
    const last = row.lastAt ? new Date(row.lastAt) : row.createdAt
    return {
      ...row,
      unread: !seen || last > seen,
    }
  })
}

/** One enquiry and its thread, marked read for whoever opened it. */
export async function getEnquiry(id: string, actor: SessionUser) {
  const trader = alias(users, 'enquiry_trader')
  const [enquiry] = await db
    .select({
      enquiry: tradeEnquiries,
      traderName: trader.name,
      dealReference: deals.reference,
    })
    .from(tradeEnquiries)
    .leftJoin(trader, eq(trader.id, tradeEnquiries.traderId))
    .leftJoin(deals, eq(deals.id, tradeEnquiries.dealId))
    .where(eq(tradeEnquiries.id, id))
    .limit(1)
  if (!enquiry) return null
  // A trade partner reads their own and nothing else.
  if (actor.role === 'TRADER' && enquiry.enquiry.traderId !== actor.id) return null

  const author = alias(users, 'message_author')
  const messages = await db
    .select({
      id: tradeMessages.id,
      body: tradeMessages.body,
      authorId: tradeMessages.authorId,
      authorName: author.name,
      createdAt: tradeMessages.createdAt,
    })
    .from(tradeMessages)
    .leftJoin(author, eq(author.id, tradeMessages.authorId))
    .where(eq(tradeMessages.enquiryId, id))
    .orderBy(asc(tradeMessages.createdAt))

  await db.update(tradeEnquiries).set(
    actor.role === 'TRADER' ? { traderReadAt: new Date() } : { staffReadAt: new Date() },
  ).where(eq(tradeEnquiries.id, id))

  return { ...enquiry, messages }
}
