import { randomBytes } from 'node:crypto'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { brands, locations, partnerOrders, partners, users, watchImages, watches, notifications } from '../db/schema'
import { recordAudit } from './audit'
import { newId } from '@/lib/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { partnerPrice } from '@/lib/partner-rate'
import { logger } from '@/lib/logger'
import { hashPassword } from '../auth/password'
import { sendWhatsApp } from './whatsapp'
import type { SessionUser } from '../auth/session'

/**
 * The partner portal: what a company sees, and what happens when they take it.
 *
 * A door with a long token in the link and a shared passphrase over it, the
 * same shape as the reseller trade room. The people using it are buyers at
 * another company, not members of staff, and giving them accounts in this
 * system would mean a user row, a role and a password reset flow for somebody
 * who needs to look at a list twice a month.
 */

/**
 * The secret in the portal URL.
 *
 * 32 random characters from a 256-bit source. This is half the access control
 * on a page that lists live stock at a negotiated price, so it is generated
 * the way a session token is rather than derived from the company's name.
 */
function newPortalToken(): string {
  return randomBytes(24).toString('base64url').slice(0, 32)
}

export interface PortalDoor {
  id: string
  name: string
  /** Whether there is a mark to draw. The bytes come from their own route. */
  hasLogo: boolean
  brandColor: string
  accentColor: string
  discountBps: number
  displayCurrency: string
  passwordHash: string
  passwordSetAt: Date | null
}

/** The door itself: enough to draw the gate, and nothing about the stock. */
export async function getPortalDoor(token: string): Promise<PortalDoor | null> {
  if (!token || token.length < 16) return null

  const rows = await db
    .select({
      id: partners.id,
      name: partners.displayName,
      fallbackName: partners.name,
      hasLogo: sql<boolean>`${partners.logoData} is not null`,
      brandColor: partners.brandColor,
      accentColor: partners.accentColor,
      discountBps: partners.discountBps,
      displayCurrency: partners.displayCurrency,
      passwordHash: partners.portalPasswordHash,
      passwordSetAt: partners.portalPasswordSetAt,
    })
    .from(partners)
    .where(and(
      eq(partners.portalToken, token),
      eq(partners.isActive, true),
      isNull(partners.deletedAt),
    ))
    .limit(1)

  const row = rows[0]
  // A token with no passphrase is not a door. Issuing one and setting the
  // other are two steps, and between them the link must open nothing —
  // otherwise the gap is a public page showing live stock and our margins.
  if (!row || !row.passwordHash) return null

  return {
    id: row.id,
    name: row.name || row.fallbackName,
    hasLogo: row.hasLogo,
    brandColor: row.brandColor,
    accentColor: row.accentColor,
    discountBps: row.discountBps,
    displayCurrency: row.displayCurrency,
    passwordHash: row.passwordHash,
    passwordSetAt: row.passwordSetAt,
  }
}

/**
 * Stock a partner may be offered.
 *
 * Alex, on whether partners should see each other's reservations:
 * "Competative landscape doesn't work as it could be held by a retail
 * customer so it should just dissapear if held / reserved."
 *
 * So a held piece is not greyed out, not marked taken, not shown at all. The
 * reason is better than tidiness: a hold here means nothing about partners —
 * it is just as likely a walk-in with a deposit down — and a portal that
 * displayed "reserved" would be inventing a story about demand out of our own
 * shop floor. Absent is the only honest state.
 */
function onOffer() {
  return [
    eq(watches.status, 'IN_STOCK'),
    isNull(watches.deletedAt),
  ]
}

export interface PortalItem {
  id: string
  brandName: string
  model: string | null
  modelName: string | null
  year: number | null
  condition: string | null
  boxPapers: string | null
  caseSizeMm: number | null
  caseMaterial: string | null
  dial: string | null
  bracelet: string | null
  /** The asking price, and what this partner pays for it. */
  askingGbp: number
  priceGbp: number
  /** The floor, where one is recorded. Null means there is nothing to hold to. */
  tradeGbp: number | null
  imageIds: string[]
}

export interface PortalRoom {
  partner: {
    id: string
    name: string
    hasLogo: boolean
    brandColor: string
    accentColor: string
    discountBps: number
  }
  items: PortalItem[]
  orders: PortalOrder[]
}

export interface PortalOrder {
  id: string
  status: string
  /** What the watch itself says. A hold is only live while this is RESERVED. */
  watchStatus: string
  placedAt: Date
  priceAtOrder: number
  brandName: string
  model: string | null
  modelName: string | null
  placedByName: string | null
}

/**
 * What the portal shows: stock at their rate, and what they have already taken.
 *
 * Both halves matter. A partner who reserves a watch watches it vanish from
 * the list — that is the point of the rule above — and without their own
 * orders beside it the portal would read as having eaten the thing they just
 * asked for.
 *
 * Only priced stock. A watch with no asking price cannot be discounted into
 * one, and quoting a partner off a blank is how a piece leaves at a number
 * nobody chose.
 */
export async function getPortalRoom(token: string): Promise<PortalRoom | null> {
  const door = await getPortalDoor(token)
  if (!door) return null

  const stock = await db
    .select({
      id: watches.id,
      brandName: brands.name,
      model: watches.model,
      modelName: watches.modelName,
      year: watches.year,
      condition: watches.condition,
      boxPapers: watches.boxPapers,
      caseSizeMm: watches.caseSizeMm,
      caseMaterial: watches.caseMaterial,
      dial: watches.dial,
      bracelet: watches.bracelet,
      askingGbp: watches.estSaleGbp,
      // The floor the rate may not go through. Fetched everywhere a partner
      // price is worked out, because a floor the query forgets is not a floor.
      tradeGbp: watches.tradePriceGbp,
      /*
       * The website photographs, and only those.
       *
       * Alex: "do not use any trade images what so ever." A trade shot is a
       * record picture — taken to prove a piece is in hand, marks and all, on
       * whatever surface was nearest. A dealer wants exactly that. A partner
       * is buying the watch for somebody's wrist, often for a member of their
       * own staff, and a page selling at a negotiated price with a record
       * picture on it undercuts the price it is asking.
       */
      imageIds: sql<string[]>`coalesce((
        SELECT array_agg(i.id ORDER BY i.sort_order, i.created_at)
        FROM watch_images i WHERE i.watch_id = watches.id AND i.kind = 'WATCH'
      ), ARRAY[]::text[])`,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .innerJoin(locations, eq(locations.id, watches.locationId))
    .where(and(
      ...onOffer(),
      sql`${watches.estSaleGbp} IS NOT NULL`,
      /*
       * And a website photograph of it.
       *
       * Asked for as part of the query rather than filtered afterwards, so
       * the count on the page and the rows on the page agree. A card reading
       * "no photograph" is a line of text claiming we have something, which
       * is what a spreadsheet is for and what this page exists to replace —
       * and a partner cannot judge a watch from it anyway.
       */
      sql`EXISTS (
        SELECT 1 FROM watch_images i
        WHERE i.watch_id = watches.id AND i.kind = 'WATCH'
      )`,
    ))
    .orderBy(asc(brands.name), asc(watches.model))

  const orders = await db
    .select({
      id: partnerOrders.id,
      status: partnerOrders.status,
      placedAt: partnerOrders.placedAt,
      priceAtOrder: partnerOrders.priceAtOrder,
      brandName: brands.name,
      model: watches.model,
      modelName: watches.modelName,
      placedByName: partnerOrders.placedByName,
      /*
       * The watch's own status, carried so the page can check rather than
       * trust.
       *
       * The order used to be the only word on whether something was held, and
       * the two drifted the moment a watch was taken off hold by any route
       * other than the Release button: the piece went back on sale to
       * everybody while the company that reserved it was still being told it
       * was theirs. Writes now close the order wherever the watch moves, and
       * this is the second belt — it heals a row that drifted before that
       * existed, on the next page load, without anybody running anything.
       */
      watchStatus: watches.status,
    })
    .from(partnerOrders)
    .innerJoin(watches, eq(watches.id, partnerOrders.watchId))
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(eq(partnerOrders.partnerId, door.id))
    .orderBy(desc(partnerOrders.placedAt))
    .limit(50)

  return {
    partner: {
      id: door.id,
      name: door.name,
      hasLogo: door.hasLogo,
      brandColor: door.brandColor,
      accentColor: door.accentColor,
      discountBps: door.discountBps,
    },
    items: stock.map((row) => ({
      ...row,
      askingGbp: row.askingGbp as number,
      // The price is worked out here, from the rate on the partner and the
      // watch's asking price as it stands right now. Nothing is stored until
      // somebody orders, and then it is stored as history.
      priceGbp: partnerPrice(row.askingGbp, door.discountBps, row.tradeGbp) as number,
      imageIds: row.imageIds ?? [],
    })),
    orders,
  }
}

/**
 * A photograph, behind the same door as the page that listed it.
 *
 * The kind filter is the access control, exactly as it is on the shop window
 * and in the trade room: a closed list of what this door may serve, so that a
 * warranty card — a serial, a date and a dealer's stamp — cannot be fetched by
 * guessing at the route with an id from somewhere else.
 */
export async function getPortalImage(token: string, imageId: string) {
  if (!token || token.length < 16 || !imageId) return null

  const rows = await db
    .select({ data: watchImages.data, mime: watchImages.mimeType, size: watchImages.byteSize })
    .from(watchImages)
    .innerJoin(watches, eq(watches.id, watchImages.watchId))
    .innerJoin(locations, eq(locations.id, watches.locationId))
    .innerJoin(partners, and(
      eq(partners.portalToken, token),
      sql`${partners.portalPasswordHash} IS NOT NULL`,
      eq(partners.isActive, true),
      isNull(partners.deletedAt),
    ))
    .where(and(
      eq(watchImages.id, imageId),
      // One kind, and it is the access control as much as the choice: a
      // warranty card — a serial, a date and a dealer's stamp — cannot be
      // fetched here by guessing at the route with an id from somewhere else.
      sql`${watchImages.kind} = 'WATCH'`,
      ...onOffer(),
    ))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return { data: row.data, mimeType: row.mime, byteSize: row.size }
}

export interface PlaceOrderInput {
  watchId: string
  placedByName: string | null
  placedByEmail: string | null
  note: string | null
}

/**
 * A partner says they want one, and the watch goes on hold.
 *
 * No payment and no sale: the piece is still ours, and an invoice is raised
 * here the ordinary way when the money is agreed. What this does is take the
 * watch off the market so two people cannot be promised it, and tell our team
 * that somebody is waiting.
 *
 * Nobody is signed in, so the audit records no actor and names the company
 * instead. Attributing it to a member of staff would be a lie in the one log
 * that has to be literally true.
 */
export async function placeOrder(token: string, input: PlaceOrderInput): Promise<string> {
  const door = await getPortalDoor(token)
  if (!door) throw new NotFoundError('Portal')

  return withTransaction(async () => {
    const rows = await db.select({
      id: watches.id,
      stockNo: watches.stockNo,
      status: watches.status,
      version: watches.version,
      askingGbp: watches.estSaleGbp,
      tradeGbp: watches.tradePriceGbp,
      deletedAt: watches.deletedAt,
    }).from(watches).where(eq(watches.id, input.watchId)).limit(1)

    const watch = rows[0]
    if (!watch || watch.deletedAt) throw new NotFoundError('Watch')

    /*
     * Checked again here, against the row, rather than trusted from the page.
     *
     * The list a partner is looking at was true when it rendered. Between
     * then and the button there is a walk-in, another partner, and anybody
     * on the shop floor marking the piece sold — and the whole purpose of a
     * hold is that the second person to ask is told no.
     */
    if (watch.status !== 'IN_STOCK') {
      throw new ConflictError('That watch has just gone. The list has moved on without it.')
    }
    if (watch.askingGbp === null) {
      throw new ValidationError('That watch has no price yet.')
    }

    const price = partnerPrice(watch.askingGbp, door.discountBps, watch.tradeGbp)
    if (price === null) throw new ValidationError('That watch has no price yet.')

    const id = newId('pord')
    await db.insert(partnerOrders).values({
      id,
      partnerId: door.id,
      watchId: watch.id,
      // The three numbers as they stand now. An order reads back as what was
      // actually promised, whatever the watch is repriced to afterwards.
      askingAtOrder: watch.askingGbp,
      discountBpsAtOrder: door.discountBps,
      priceAtOrder: price,
      placedByName: input.placedByName?.trim() || null,
      placedByEmail: input.placedByEmail?.trim() || null,
      note: input.note?.trim() || null,
      status: 'PLACED',
    })

    await db.update(watches)
      .set({ status: 'RESERVED', updatedAt: new Date(), version: watch.version + 1 })
      .where(eq(watches.id, watch.id))

    await recordAudit({
      entityType: 'Watch', entityId: watch.id, action: 'UPDATE', actorId: null,
      summary: `Stock ${watch.stockNo} held for ${door.name} (partner order)`,
      changes: { status: { from: watch.status, to: 'RESERVED' } },
    })

    await tellTheTeam({
      title: `${door.name} has reserved stock ${watch.stockNo}`,
      body: input.placedByName
        ? `${input.placedByName} placed it through the portal. Nothing is paid — it is on hold until somebody here moves it on or releases it.`
        : 'Placed through the portal. Nothing is paid — it is on hold until somebody here moves it on or releases it.',
      entityId: watch.id,
    })

    return id
  })
}

/**
 * Who hears about a partner order: the owner, as with trade enquiries.
 *
 * Alex, on what happens when a hold is released: tell our team, not the
 * partner. The same holds for the order arriving — this is a queue for us,
 * and a partner who has just clicked the button already knows what they did.
 */
async function tellTheTeam(notice: { title: string; body: string; entityId: string }): Promise<void> {
  const people = await db
    .select({ id: users.id, phone: users.phone })
    .from(users)
    .where(and(eq(users.role, 'OWNER'), eq(users.isActive, true), isNull(users.deletedAt)))

  for (const person of people) {
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

  /*
   * The relay is attempted after, and a failure is logged rather than thrown.
   *
   * Everything above is already written. An order that exists only if
   * WhatsApp was reachable is an order that goes missing on the day it
   * matters, and the watch is already off the market either way.
   */
  for (const person of people) {
    if (!person.phone) continue
    const result = await sendWhatsApp(person.phone, `${notice.title}\n${notice.body}`)
    if (!result.sent) logger.info('partner order not relayed', { note: result.note })
  }
}

/**
 * Open a partner's portal, or change the passphrase on one.
 *
 * Both at once, because they are the same decision: a token with no
 * passphrase opens nothing. The token is minted on the first call and kept on
 * every call after, so changing the passphrase does not break a link the
 * partner already has.
 *
 * The passphrase is never read back. What gets handed over is whatever was
 * typed here, and if that is lost the answer is to set a new one.
 */
export async function setPortalAccess(
  id: string,
  passphrase: string,
  actor: SessionUser,
): Promise<string> {
  // Shared secrets get written on a pad and read down a phone, so the staff
  // password policy is the wrong test here; length is the one that survives
  // being spoken.
  const value = passphrase.trim()
  if (value.length < 12) {
    throw new ValidationError('That passphrase is too short.', {
      passphrase: 'Use at least 12 characters — a short phrase is easier to read out than a complicated word.',
    })
  }

  return withTransaction(async () => {
    const rows = await db.select().from(partners).where(eq(partners.id, id)).limit(1)
    const existing = rows[0]
    if (!existing || existing.deletedAt) throw new NotFoundError('Partner')

    const portalToken = existing.portalToken ?? newPortalToken()
    await db.update(partners)
      .set({
        portalToken,
        portalPasswordHash: await hashPassword(value),
        portalPasswordSetAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(partners.id, id))

    await recordAudit({
      entityType: 'Partner', entityId: id, action: 'UPDATE', actorId: actor.id,
      summary: existing.portalToken
        ? `${existing.name}: portal passphrase changed, everyone signed out`
        : `${existing.name}: portal opened`,
    })
    return portalToken
  })
}

/**
 * Shut the portal.
 *
 * Both halves, because either on its own leaves something that reads as
 * working: a passphrase guarding nothing, or a live-looking URL that opens
 * nothing — and somebody would reasonably read that URL still existing as the
 * access still existing.
 */
export async function closePortal(id: string, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const rows = await db.select().from(partners).where(eq(partners.id, id)).limit(1)
    const existing = rows[0]
    if (!existing || existing.deletedAt) throw new NotFoundError('Partner')

    await db.update(partners)
      .set({
        portalToken: null,
        portalPasswordHash: null,
        portalPasswordSetAt: null,
        updatedAt: new Date(),
      })
      .where(eq(partners.id, id))

    await recordAudit({
      entityType: 'Partner', entityId: id, action: 'UPDATE', actorId: actor.id,
      summary: `${existing.name}: portal closed`,
    })
  })
}

/**
 * The stock a partner could be offered, by partner id rather than by token.
 *
 * The portal's own list answers through the door, which is right for a page
 * behind a passphrase and wrong for our side of it: somebody here building a
 * shortlist for a company whose portal has not been opened yet would
 * otherwise be shown nothing at all, and would reasonably conclude there is
 * no stock.
 *
 * The same rules and the same arithmetic as the portal, so a shortlist is
 * picked from exactly what the partner would see.
 */
export async function stockForPartner(partnerId: string): Promise<PortalItem[]> {
  const [partner] = await db
    .select({ discountBps: partners.discountBps })
    .from(partners)
    .where(and(eq(partners.id, partnerId), isNull(partners.deletedAt)))
    .limit(1)
  if (!partner) return []

  const rows = await db
    .select({
      id: watches.id,
      brandName: brands.name,
      model: watches.model,
      modelName: watches.modelName,
      year: watches.year,
      condition: watches.condition,
      boxPapers: watches.boxPapers,
      caseSizeMm: watches.caseSizeMm,
      caseMaterial: watches.caseMaterial,
      dial: watches.dial,
      bracelet: watches.bracelet,
      askingGbp: watches.estSaleGbp,
      // The floor the rate may not go through. Selected everywhere a partner
      // price is worked out, because a floor the query forgets to fetch is a
      // floor that is not there.
      tradeGbp: watches.tradePriceGbp,
      imageIds: sql<string[]>`coalesce((
        SELECT array_agg(i.id ORDER BY i.sort_order, i.created_at)
        FROM watch_images i WHERE i.watch_id = watches.id AND i.kind = 'WATCH'
      ), ARRAY[]::text[])`,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(and(
      ...onOffer(),
      sql`${watches.estSaleGbp} IS NOT NULL`,
      sql`EXISTS (
        SELECT 1 FROM watch_images i
        WHERE i.watch_id = watches.id AND i.kind = 'WATCH'
      )`,
    ))
    .orderBy(asc(brands.name), asc(watches.model))

  return rows.map((row) => ({
    ...row,
    askingGbp: row.askingGbp as number,
    priceGbp: partnerPrice(row.askingGbp, partner.discountBps, row.tradeGbp) as number,
    imageIds: row.imageIds ?? [],
  }))
}
