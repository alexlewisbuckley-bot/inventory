import { randomBytes } from 'node:crypto'
import { and, asc, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db, withTransaction } from '../db/client'
import { brands, resellerEnquiries, resellers, watchImages, watches } from '../db/schema'
import { recordAudit } from './audit'
import { diff } from '@/lib/diff'
import { newId, slugify } from '@/lib/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { fromBase, type RateTable } from '@/lib/currency'
import { sendMail } from './mailer'
import { parseNavLinks, type NavLink } from '@/lib/validation'
import type { resellerSchema } from '@/lib/validation'
import type { SessionUser } from '../auth/session'

type ResellerInput = z.infer<typeof resellerSchema>

/**
 * The secret in the shop-window URL.
 *
 * 32 random characters from a 256-bit source. This is the whole of the access
 * control on a page that lists live stock, so it is generated the way a session
 * token is rather than derived from the reseller's name — a URL somebody can
 * guess from the company is not access control, it is an invitation.
 */
export function newPublicToken(): string {
  return randomBytes(24).toString('base64url')
}

/** Reseller list for the management page, with how much stock each can show. */
export async function listResellers() {
  const rows = await db
    .select({
      id: resellers.id,
      name: resellers.name,
      displayName: resellers.displayName,
      headline: resellers.headline,
      intro: resellers.intro,
      contactName: resellers.contactName,
      contactEmail: resellers.contactEmail,
      contactPhone: resellers.contactPhone,
      website: resellers.website,
      brandColor: resellers.brandColor,
      accentColor: resellers.accentColor,
      displayCurrency: resellers.displayCurrency,
      publicToken: resellers.publicToken,
      isActive: resellers.isActive,
      notes: resellers.notes,
      navLinks: resellers.navLinks,
      hasLogo: sql<boolean>`${resellers.logoData} is not null`,
      updatedAt: resellers.updatedAt,
    })
    .from(resellers)
    .where(isNull(resellers.deletedAt))
    .orderBy(asc(resellers.sortOrder))

  // One count for everybody rather than one query each: the number is the same
  // for every reseller, because they all see the same available stock.
  const available = await countAvailableStock()
  return rows.map((row) => ({ ...row, availableCount: available }))
}

/** How many watches a shop window would show right now. */
export async function countAvailableStock(): Promise<number> {
  const rows = await db.select({ value: count() }).from(watches)
    .where(and(eq(watches.status, 'IN_STOCK'), isNull(watches.deletedAt)))
  return Number(rows[0]?.value ?? 0)
}

export async function createReseller(input: ResellerInput, actor: SessionUser): Promise<string> {
  return withTransaction(async () => {
    const slug = slugify(input.name)
    const clash = await db.select({ id: resellers.id }).from(resellers)
      .where(and(eq(resellers.slug, slug), isNull(resellers.deletedAt))).limit(1)
    if (clash[0]) throw new ConflictError('A reseller with that name already exists.', { name: 'Already in use.' })

    // A deleted reseller keeps its row, and its slug with it. Uniqueness is
    // scoped to the living, but a database that has not had that change
    // applied yet would refuse this insert on an index rather than on the
    // check above — which reaches the user as a save that will not save, with
    // no way to work out that the name is being held by something they
    // deleted. Standing the old slug aside costs one statement and makes the
    // outcome the same either way.
    await db.update(resellers)
      .set({ slug: sql`${resellers.slug} || '-deleted-' || ${resellers.id}` })
      .where(and(eq(resellers.slug, slug), isNotNull(resellers.deletedAt)))

    const highest = await db.select({ max: sql<number>`coalesce(max(${resellers.sortOrder}), 0)` }).from(resellers)
    const id = newId('rsl')
    const { navLinks, ...rest } = input
    await db.insert(resellers).values({
      id,
      slug,
      publicToken: newPublicToken(),
      sortOrder: Number(highest[0]?.max ?? 0) + 1,
      createdById: actor.id,
      ...rest,
      // Serialised at the boundary: validated objects go in, a string is what
      // the column holds.
      navLinks: navLinks && navLinks.length > 0 ? JSON.stringify(navLinks) : null,
    })
    await recordAudit({
      entityType: 'Reseller', entityId: id, action: 'CREATE', actorId: actor.id,
      summary: `Reseller ${input.name} added`,
    })
    return id
  })
}

export async function updateReseller(id: string, input: Partial<ResellerInput>, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const rows = await db.select().from(resellers).where(eq(resellers.id, id)).limit(1)
    const existing = rows[0]
    if (!existing || existing.deletedAt) throw new NotFoundError('Reseller')

    const { navLinks, ...rest } = input
    const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if (input.name && input.name !== existing.name) patch.slug = slugify(input.name)
    if (navLinks !== undefined) {
      patch.navLinks = navLinks.length > 0 ? JSON.stringify(navLinks) : null
    }

    await db.update(resellers).set(patch).where(eq(resellers.id, id))
    await recordAudit({
      entityType: 'Reseller', entityId: id, action: 'UPDATE', actorId: actor.id,
      summary: `Reseller ${existing.name} updated`,
      // Compared against the patch rather than the input, so the navigation
      // reads as the string that was stored rather than as an object the
      // audit log cannot render.
      changes: diff(existing, patch, [
        'name', 'displayName', 'headline', 'intro', 'contactName', 'contactEmail',
        'contactPhone', 'website', 'brandColor', 'accentColor', 'displayCurrency',
        'navLinks', 'notes', 'isActive',
      ]),
    })
  })
}

/**
 * Issue a new shop-window link and invalidate the old one.
 *
 * The only way to take back a link that has been forwarded somewhere it should
 * not have been. Audited loudly, because it breaks a URL somebody else is
 * relying on and the reason wants to be findable later.
 */
export async function rotateResellerToken(id: string, actor: SessionUser): Promise<string> {
  return withTransaction(async () => {
    const rows = await db.select().from(resellers).where(eq(resellers.id, id)).limit(1)
    const existing = rows[0]
    if (!existing || existing.deletedAt) throw new NotFoundError('Reseller')

    const publicToken = newPublicToken()
    await db.update(resellers).set({ publicToken, updatedAt: new Date() }).where(eq(resellers.id, id))
    await recordAudit({
      entityType: 'Reseller', entityId: id, action: 'UPDATE', actorId: actor.id,
      summary: `Reseller ${existing.name}: shop link reissued, the previous one stopped working`,
    })
    return publicToken
  })
}

export async function setResellerLogo(
  id: string,
  logo: { data: Buffer; mimeType: string } | null,
  actor: SessionUser,
): Promise<void> {
  const rows = await db.select({ name: resellers.name, deletedAt: resellers.deletedAt })
    .from(resellers).where(eq(resellers.id, id)).limit(1)
  const existing = rows[0]
  if (!existing || existing.deletedAt) throw new NotFoundError('Reseller')

  await db.update(resellers).set({
    logoData: logo?.data ?? null,
    logoMime: logo?.mimeType ?? null,
    logoByteSize: logo?.data.byteLength ?? null,
    updatedAt: new Date(),
  }).where(eq(resellers.id, id))

  await recordAudit({
    entityType: 'Reseller', entityId: id, action: 'UPDATE', actorId: actor.id,
    summary: `Reseller ${existing.name}: logo ${logo ? 'updated' : 'removed'}`,
  })
}

export async function getResellerLogo(id: string) {
  const rows = await db
    .select({ data: resellers.logoData, mime: resellers.logoMime })
    .from(resellers)
    .where(and(eq(resellers.id, id), isNull(resellers.deletedAt)))
    .limit(1)
  const row = rows[0]
  if (!row?.data || !row.mime) return null
  return { data: row.data, mimeType: row.mime }
}

export async function deleteReseller(id: string, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const rows = await db.select().from(resellers).where(eq(resellers.id, id)).limit(1)
    const existing = rows[0]
    if (!existing || existing.deletedAt) throw new NotFoundError('Reseller')

    // The name goes back into circulation with the row, rather than being
    // reserved by something nobody can see any more.
    await db.update(resellers)
      .set({
        deletedAt: new Date(),
        isActive: false,
        slug: `${existing.slug}-deleted-${existing.id}`,
      })
      .where(eq(resellers.id, id))
    await recordAudit({
      entityType: 'Reseller', entityId: id, action: 'DELETE', actorId: actor.id,
      summary: `Reseller ${existing.name} removed, and their shop link stopped working`,
    })
  })
}

/** What a shop window shows about one watch. */
export interface ShopWindowItem {
  id: string
  brandName: string
  model: string
  nickname: string | null
  year: number | null
  condition: string
  boxPapers: string
  productType: string
  /** In the reseller's display currency, minor units. Null when unpriced. */
  price: number | null
  imageId: string | null
  /** Every photograph, so the detail view can show more than the first. */
  imageIds: string[]
  caseSizeMm: number | null
  caseMaterial: string | null
  dial: string | null
  bracelet: string | null
  movement: string | null
  waterResistanceM: number | null
  description: string | null
}

export interface ShopWindow {
  reseller: {
    id: string
    name: string
    headline: string | null
    intro: string | null
    contactName: string | null
    contactEmail: string | null
    contactPhone: string | null
    website: string | null
    brandColor: string
    accentColor: string
    displayCurrency: string
    navLinks: NavLink[]
    hasLogo: boolean
  }
  items: ShopWindowItem[]
}

/**
 * The shop window behind one token.
 *
 * Deliberately not a filtered version of the inventory query. The columns a
 * customer may see are named here and nothing else is fetched, so cost, margin,
 * supplier, serial, location and owner cannot reach the page even by mistake —
 * not hidden in the markup, not present in a payload somebody can read. The
 * safest way to not leak a figure is to never select it.
 *
 * Returns null for an unknown, deleted or deactivated reseller, so a revoked
 * link is indistinguishable from one that never existed.
 */
export async function getShopWindow(token: string, rates: RateTable): Promise<ShopWindow | null> {
  if (!token || token.length < 16) return null

  const rows = await db
    .select({
      id: resellers.id,
      name: resellers.name,
      displayName: resellers.displayName,
      headline: resellers.headline,
      intro: resellers.intro,
      contactName: resellers.contactName,
      contactEmail: resellers.contactEmail,
      contactPhone: resellers.contactPhone,
      website: resellers.website,
      brandColor: resellers.brandColor,
      accentColor: resellers.accentColor,
      displayCurrency: resellers.displayCurrency,
      navLinks: resellers.navLinks,
      hasLogo: sql<boolean>`${resellers.logoData} is not null`,
    })
    .from(resellers)
    .where(and(
      eq(resellers.publicToken, token),
      eq(resellers.isActive, true),
      isNull(resellers.deletedAt),
    ))
    .limit(1)

  const reseller = rows[0]
  if (!reseller) return null

  const currency = reseller.displayCurrency

  const stock = await db
    .select({
      id: watches.id,
      brandName: brands.name,
      model: watches.model,
      nickname: watches.nickname,
      year: watches.year,
      condition: watches.condition,
      boxPapers: watches.boxPapers,
      productType: watches.productType,
      estSaleGbp: watches.estSaleGbp,
      caseSizeMm: watches.caseSizeMm,
      caseMaterial: watches.caseMaterial,
      dial: watches.dial,
      bracelet: watches.bracelet,
      movement: watches.movement,
      waterResistanceM: watches.waterResistanceM,
      description: watches.description,
      // Every photograph, in the order they were arranged, as an array. One
      // query rather than one per watch: a shop window is a page of them.
      imageIds: sql<string[]>`coalesce((
        SELECT array_agg(i.id ORDER BY i.sort_order, i.created_at)
        FROM watch_images i WHERE i.watch_id = ${watches.id}
      ), ARRAY[]::text[])`,
      imageId: sql<string | null>`(
        SELECT i.id FROM watch_images i
        WHERE i.watch_id = ${watches.id}
        ORDER BY i.sort_order, i.created_at
        LIMIT 1
      )`,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    // Available means available. Reserved and sale-agreed stock is spoken for,
    // and showing it is how a reseller promises a customer a watch that is
    // already going to somebody else.
    .where(and(eq(watches.status, 'IN_STOCK'), isNull(watches.deletedAt)))
    .orderBy(asc(brands.name), asc(watches.model))

  return {
    reseller: {
      id: reseller.id,
      name: reseller.displayName || reseller.name,
      headline: reseller.headline,
      intro: reseller.intro,
      contactName: reseller.contactName,
      contactEmail: reseller.contactEmail,
      contactPhone: reseller.contactPhone,
      website: reseller.website,
      brandColor: reseller.brandColor,
      accentColor: reseller.accentColor,
      displayCurrency: currency,
      navLinks: parseNavLinks(reseller.navLinks),
      hasLogo: reseller.hasLogo,
    },
    items: stock.map((row) => ({
      id: row.id,
      brandName: row.brandName,
      model: row.model,
      nickname: row.nickname,
      year: row.year,
      condition: row.condition,
      boxPapers: row.boxPapers,
      productType: row.productType,
      price: row.estSaleGbp === null ? null : fromBase(row.estSaleGbp, currency, rates),
      imageId: row.imageId,
      imageIds: row.imageIds ?? [],
      caseSizeMm: row.caseSizeMm,
      caseMaterial: row.caseMaterial,
      dial: row.dial,
      bracelet: row.bracelet,
      movement: row.movement,
      waterResistanceM: row.waterResistanceM,
      description: row.description,
    })),
  }
}

/** Guard for logo uploads. */
export function assertLogoAcceptable(mimeType: string, byteSize: number): void {
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
  if (!allowed.includes(mimeType)) {
    throw new ValidationError('A logo must be a PNG, JPEG, WebP or SVG file.')
  }
  if (byteSize > 2 * 1024 * 1024) {
    throw new ValidationError('That logo is larger than 2MB. Please use a smaller file.')
  }
}

/**
 * A photograph, for a shop window.
 *
 * The signed-in image route is not reachable from a public page, and pointing
 * one at the other would have made every stock photograph public. So this is a
 * separate door with its own lock: the token is checked again here, and the
 * image must belong to a watch that is actually on sale. An id alone opens
 * nothing, which matters because ids appear in the markup of the page.
 */
export async function getShopImage(token: string, imageId: string) {
  if (!token || token.length < 16 || !imageId) return null

  const rows = await db
    .select({ data: watchImages.data, mime: watchImages.mimeType, size: watchImages.byteSize })
    .from(watchImages)
    .innerJoin(watches, eq(watches.id, watchImages.watchId))
    .innerJoin(resellers, and(
      eq(resellers.publicToken, token),
      eq(resellers.isActive, true),
      isNull(resellers.deletedAt),
    ))
    .where(and(
      eq(watchImages.id, imageId),
      eq(watches.status, 'IN_STOCK'),
      isNull(watches.deletedAt),
    ))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return { data: row.data, mimeType: row.mime, byteSize: row.size }
}

/** The reseller's own logo, behind the same token as their page. */
export async function getShopLogo(token: string) {
  if (!token || token.length < 16) return null
  const rows = await db
    .select({ data: resellers.logoData, mime: resellers.logoMime })
    .from(resellers)
    .where(and(
      eq(resellers.publicToken, token),
      eq(resellers.isActive, true),
      isNull(resellers.deletedAt),
    ))
    .limit(1)
  const row = rows[0]
  if (!row?.data || !row.mime) return null
  return { data: row.data, mimeType: row.mime }
}

/**
 * Record an enquiry, then try to deliver it.
 *
 * In that order, and deliberately. The row is the thing that must not be lost:
 * a customer who fills in a form has done their part, and whether a mail
 * provider is configured on this deployment is not their problem. The send is
 * attempted afterwards and its outcome written back, so an enquiry nobody
 * received is visible in the application rather than gone.
 *
 * The token is checked here rather than trusted from the caller: this is the
 * one write in the application reachable without a session.
 */
export async function recordEnquiry(
  token: string,
  watchId: string,
  input: { name: string; email: string; phone: string | null; message: string | null },
): Promise<{ ok: boolean; delivered: boolean }> {
  if (!token || token.length < 16) return { ok: false, delivered: false }

  const rows = await db
    .select({
      id: resellers.id,
      name: resellers.name,
      displayName: resellers.displayName,
      contactEmail: resellers.contactEmail,
    })
    .from(resellers)
    .where(and(
      eq(resellers.publicToken, token),
      eq(resellers.isActive, true),
      isNull(resellers.deletedAt),
    ))
    .limit(1)
  const reseller = rows[0]
  if (!reseller) return { ok: false, delivered: false }

  // The piece has to be one this shop is actually showing, or an id from
  // anywhere would attach an enquiry to any watch in the book.
  const watches_ = await db
    .select({ id: watches.id, model: watches.model, nickname: watches.nickname, brandId: watches.brandId })
    .from(watches)
    .where(and(eq(watches.id, watchId), eq(watches.status, 'IN_STOCK'), isNull(watches.deletedAt)))
    .limit(1)
  const watch = watches_[0]
  if (!watch) return { ok: false, delivered: false }

  const brand = await db.select({ name: brands.name }).from(brands)
    .where(eq(brands.id, watch.brandId)).limit(1)
  const subject = `${brand[0]?.name ?? ''} ${watch.nickname || watch.model}`.trim()

  const id = newId('enq')
  await db.insert(resellerEnquiries).values({
    id,
    resellerId: reseller.id,
    watchId: watch.id,
    subject,
    name: input.name,
    email: input.email,
    phone: input.phone,
    message: input.message,
  })

  if (!reseller.contactEmail) {
    await db.update(resellerEnquiries)
      .set({ delivery: 'FAILED', deliveryNote: 'This reseller has no contact email set, so there was nowhere to send it.' })
      .where(eq(resellerEnquiries.id, id))
    return { ok: true, delivered: false }
  }

  const result = await sendMail({
    to: reseller.contactEmail,
    replyTo: input.email,
    subject: `Enquiry: ${subject}`,
    text: [
      `${input.name} has enquired about ${subject}.`,
      '',
      `Reference: ${watch.model}`,
      `Email: ${input.email}`,
      input.phone ? `Phone: ${input.phone}` : null,
      '',
      input.message ? input.message : '(No message left.)',
      '',
      '—',
      `Sent from the ${reseller.displayName || reseller.name} stock list.`,
    ].filter((line) => line !== null).join('\n'),
  })

  await db.update(resellerEnquiries)
    .set({ delivery: result.sent ? 'SENT' : 'FAILED', deliveryNote: result.note })
    .where(eq(resellerEnquiries.id, id))

  return { ok: true, delivered: result.sent }
}

/** Enquiries for the management page, newest first. */
export async function listEnquiries(resellerId: string, limit = 50) {
  return db
    .select()
    .from(resellerEnquiries)
    .where(eq(resellerEnquiries.resellerId, resellerId))
    .orderBy(desc(resellerEnquiries.createdAt))
    .limit(limit)
}

/** How many enquiries each reseller has taken. */
export async function enquiryCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ resellerId: resellerEnquiries.resellerId, value: count() })
    .from(resellerEnquiries)
    .groupBy(resellerEnquiries.resellerId)
  return Object.fromEntries(rows.map((row) => [row.resellerId, Number(row.value)]))
}
