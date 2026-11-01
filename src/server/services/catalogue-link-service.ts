import { randomBytes } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { brands, catalogueLinks, locations, watchImages, watches } from '../db/schema'
import { recordAudit } from './audit'
import { newId } from '@/lib/ids'
import { NotFoundError, ValidationError } from '@/lib/errors'
import type { TradeItem } from '@/components/trade/TradeRoom'
import type { SessionUser } from '../auth/session'

/**
 * The list we hand the trade.
 *
 * Alex: "Create a catalogue link that shows all the watches except in
 * transit & hong kong to show traders what we have with filtering and no
 * pricing."
 *
 * Deliberately the same room a reseller's dealers are shown, served from a
 * different door. The trade room was already a priceless dealer list with the
 * filters a dealer actually uses, and building a second one would have meant
 * two dealer-facing lists drifting apart — the next change to how a watch is
 * described landing on one of them and not the other. So the component and
 * the item shape are shared, and only three things differ:
 *
 *   - the door is ours, not a reseller's, so there is no branding to load
 *     and no passphrase to keep
 *   - a watch with no photograph is still on the list, because Alex asked
 *     for all of them and a reference with no picture is still a watch a
 *     dealer may be looking for
 *   - the places it draws from answer `showInTradeCatalogue` rather than
 *     `publishToStorefront`, which is what keeps Hong Kong off it
 *
 * No money crosses this boundary, by construction rather than by redaction:
 * `TradeItem` has no price field, so there is nothing for this query to
 * select and nothing for the page to leak.
 */

/** The secret in a catalogue URL. Minted exactly as a shop window's is. */
export function newCatalogueToken(): string {
  return randomBytes(24).toString('base64url')
}

export interface CatalogueLinkRow {
  id: string
  label: string
  token: string
  isActive: boolean
  showTradePhotos: boolean
  lastViewedAt: Date | null
  viewCount: number
  revokedAt: Date | null
  createdAt: Date
}

/**
 * Stock a trade partner may be shown.
 *
 * In stock and not deleted, the same two conditions every outward-facing
 * read applies: reserved and sale-agreed pieces are spoken for, and offering
 * one to a dealer is a call that ends in taking it back.
 *
 * Then the location's own switch. Not `publishToStorefront` — that answers
 * "may the website sell this", and Hong Kong is the case where the two
 * answers differ: real stock the site may well sell, and stock we would
 * rather not put on a list that gets forwarded round the trade. Sharing one
 * switch would have meant pulling it off onestreetwatches.com as the price
 * of pulling it off the dealer list.
 *
 * Transit is where both switches agree, and 0055 set it on both for the same
 * reason the storefront has it: a watch in a courier's bag is not a watch
 * anybody can be offered today.
 *
 * One function, because this predicate decides the list, the count and the
 * image door, and a page that lists a watch whose photograph then 404s is
 * worse than either mistake alone.
 */
function tradeable() {
  return [
    eq(watches.status, 'IN_STOCK'),
    isNull(watches.deletedAt),
    eq(locations.showInTradeCatalogue, true),
  ]
}

/**
 * Is there a catalogue behind this token.
 *
 * Separate from loading the stock so the image route can ask the same
 * question without reading a catalogue to serve one picture.
 *
 * A revoked or switched-off link is the same nothing as one that never
 * existed. Anything more specific tells whoever is holding a dead link that
 * there is something real behind it.
 */
export async function getCatalogueDoor(token: string): Promise<{
  id: string
  label: string
  showTradePhotos: boolean
} | null> {
  // A token is only ever a token. Short strings are refused before they
  // reach the database so a scan cannot use this as an index probe.
  if (!token || token.length < 16) return null

  const rows = await db
    .select({
      id: catalogueLinks.id,
      label: catalogueLinks.label,
      showTradePhotos: catalogueLinks.showTradePhotos,
    })
    .from(catalogueLinks)
    .where(and(
      eq(catalogueLinks.token, token),
      eq(catalogueLinks.isActive, true),
      isNull(catalogueLinks.revokedAt),
    ))
    .limit(1)

  return rows[0] ?? null
}

/**
 * The stock behind the link.
 *
 * Every watch, photographed or not. The reseller trade room requires a
 * picture, which quietly sets its membership — a piece bought this morning
 * and not yet shot is simply absent from it. That is the right call for a
 * reseller's own shop and the wrong one here: Alex asked for all of them,
 * and a dealer hunting a 116500LN wants to know we have one before they want
 * to see it.
 */
export async function getHouseCatalogue(token: string): Promise<{
  label: string
  items: TradeItem[]
} | null> {
  const door = await getCatalogueDoor(token)
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
      imageIds: sql<string[] | null>`coalesce((
        SELECT array_agg(i.id ORDER BY i.sort_order, i.created_at)
        FROM watch_images i WHERE i.watch_id = ${watches.id} AND i.kind = 'WATCH'
      ), ARRAY[]::text[])`,
      /*
       * The trade shots, only where this link was opened up to them.
       *
       * A trade shot is a record picture — taken on whatever surface was to
       * hand, often with the papers in frame — and this link has no
       * passphrase on it and may be forwarded anywhere. So it is off unless
       * somebody turned it on for this link, and the switch is applied in
       * the query rather than in the component: a page cannot leak a
       * photograph whose id it was never sent.
       */
      tradeImageIds: door.showTradePhotos
        ? sql<string[] | null>`coalesce((
            SELECT array_agg(i.id ORDER BY i.sort_order, i.created_at)
            FROM watch_images i WHERE i.watch_id = ${watches.id} AND i.kind = 'TRADE'
          ), ARRAY[]::text[])`
        : sql<string[] | null>`ARRAY[]::text[]`,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .innerJoin(locations, eq(locations.id, watches.locationId))
    .where(and(...tradeable()))
    .orderBy(asc(brands.name), asc(watches.model))

  return {
    label: door.label,
    items: stock.map((row) => ({
      ...row,
      imageIds: row.imageIds ?? [],
      tradeImageIds: row.tradeImageIds ?? [],
    })),
  }
}

/**
 * A photograph, behind the same door as the page that listed it.
 *
 * The kind filter is the access control, as it is on the shop window and in
 * the trade room: it names the kinds this link is for, so that a warranty
 * card — a serial, a date and a dealer's stamp — cannot be fetched by
 * guessing at the route with an id from somewhere else.
 *
 * And the trade shots only where this link offers them, so the switch holds
 * at the door as well as in the listing. Otherwise turning trade photos off
 * would hide the button and leave the pictures a URL away.
 */
export async function getCatalogueImage(token: string, imageId: string) {
  const door = await getCatalogueDoor(token)
  if (!door || !imageId) return null

  // Typed as the column's own union rather than string[], so a kind that is
  // not a kind is a compile error here rather than an empty result later.
  const kinds: Array<'WATCH' | 'TRADE'> = door.showTradePhotos ? ['WATCH', 'TRADE'] : ['WATCH']

  const rows = await db
    .select({ data: watchImages.data, mime: watchImages.mimeType, size: watchImages.byteSize })
    .from(watchImages)
    .innerJoin(watches, eq(watches.id, watchImages.watchId))
    .innerJoin(locations, eq(locations.id, watches.locationId))
    .where(and(
      eq(watchImages.id, imageId),
      inArray(watchImages.kind, kinds),
      ...tradeable(),
    ))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return { data: row.data, mimeType: row.mime, byteSize: row.size }
}

/**
 * That somebody opened it.
 *
 * Best effort and never in the request's way: a link whose counter failed to
 * increment is still a link that should render. The point of it is to make a
 * link nobody has used in three months recognisable as one worth revoking.
 */
export async function noteCatalogueView(token: string): Promise<void> {
  if (!token || token.length < 16) return
  try {
    await db.update(catalogueLinks)
      .set({
        lastViewedAt: new Date(),
        viewCount: sql`${catalogueLinks.viewCount} + 1`,
      })
      .where(eq(catalogueLinks.token, token))
  } catch {
    // Deliberately swallowed. See above.
  }
}

/** Every link ever issued, live ones first. */
export async function listCatalogueLinks(): Promise<CatalogueLinkRow[]> {
  return db
    .select({
      id: catalogueLinks.id,
      label: catalogueLinks.label,
      token: catalogueLinks.token,
      isActive: catalogueLinks.isActive,
      showTradePhotos: catalogueLinks.showTradePhotos,
      lastViewedAt: catalogueLinks.lastViewedAt,
      viewCount: catalogueLinks.viewCount,
      revokedAt: catalogueLinks.revokedAt,
      createdAt: catalogueLinks.createdAt,
    })
    .from(catalogueLinks)
    // Live ones first, then most recent: a revoked link is kept as the
    // record of what was handed out, not as something to scroll past.
    .orderBy(desc(catalogueLinks.isActive), desc(catalogueLinks.createdAt))
}

/** How many watches a catalogue link would show right now. */
export async function countTradeableStock(): Promise<number> {
  const rows = await db.select({ value: sql<number>`count(*)::int` })
    .from(watches)
    .innerJoin(locations, eq(locations.id, watches.locationId))
    .where(and(...tradeable()))
  return Number(rows[0]?.value ?? 0)
}

export async function createCatalogueLink(
  input: { label: string; showTradePhotos: boolean },
  actor: SessionUser,
): Promise<string> {
  const label = input.label.trim()
  // Named, always. A list of unlabelled tokens cannot answer "which link do
  // we withdraw", which is the only question anybody asks of it.
  if (!label) throw new ValidationError('Give the link a name.', { label: 'Required.' })

  const id = newId('clink')
  await db.insert(catalogueLinks).values({
    id,
    label,
    token: newCatalogueToken(),
    showTradePhotos: input.showTradePhotos,
    createdById: actor.id,
  })
  await recordAudit({
    entityType: 'CatalogueLink', entityId: id, action: 'CREATE', actorId: actor.id,
    summary: `Trade catalogue link "${label}" issued`,
    changes: { showTradePhotos: { from: null, to: String(input.showTradePhotos) } },
  })
  return id
}

/**
 * Withdraw one.
 *
 * Kept rather than deleted, and the token with it. "Which link did we send
 * the Dubai group and is it still live" is a question asked months later,
 * and a row that is gone cannot answer it. Switched off and stamped is
 * enough: the door reads `isActive` and `revokedAt`, so the URL is dead the
 * moment this returns.
 */
export async function revokeCatalogueLink(id: string, actor: SessionUser): Promise<void> {
  const rows = await db.select({ label: catalogueLinks.label, isActive: catalogueLinks.isActive })
    .from(catalogueLinks).where(eq(catalogueLinks.id, id)).limit(1)
  const existing = rows[0]
  if (!existing) throw new NotFoundError('Catalogue link')

  await db.update(catalogueLinks)
    .set({ isActive: false, revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(catalogueLinks.id, id))

  await recordAudit({
    entityType: 'CatalogueLink', entityId: id, action: 'UPDATE', actorId: actor.id,
    summary: `Trade catalogue link "${existing.label}" revoked`,
    changes: { isActive: { from: 'true', to: 'false' } },
  })
}
