import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/server/db/client'
import { brands, locations, watchImages, watches } from '@/server/db/schema'
import { fromBase, type RateTable } from '@/lib/currency'
import type { CurrencyCode } from '@/lib/enums'

/**
 * The stock a trade partner is shown.
 *
 * A separate service, and a column list written out by hand, because this is
 * the one read in the application whose audience is not us. The inventory
 * repository selects supplier, location, owner, serial, cost, margin and
 * notes — every one of which is ours — and the safe version of that query is
 * not a redaction of it but a different query. Adding a column here is a
 * deliberate act; forgetting to strip one from a shared select is an accident,
 * and the difference between those two is the whole point of this file.
 *
 * What a dealer gets: what the watch is, what it looks like, what came with
 * it, and the two prices they may be quoted. Nothing about where it came
 * from, what it cost, or where it sits.
 */
export interface CatalogueItem {
  id: string
  brandName: string
  model: string
  modelName: string | null
  year: number | null
  condition: string
  boxPapers: string
  productType: string
  caseSizeMm: number | null
  caseMaterial: string | null
  dial: string | null
  bracelet: string | null
  movement: string | null
  waterResistanceM: number | null
  description: string | null
  /** In the reader's display currency, minor units. */
  trade: number | null
  retail: number | null
  /** The published photograph — the one that shows the watch. */
  imageId: string | null
  /**
   * The trade shot, offered behind the card rather than led with.
   *
   * Null where there is none, and also where the trade shot is already
   * the cover — a watch with no published photograph falls back to it,
   * and a control offering what is on screen does nothing.
   */
  tradeImageId: string | null
}

export type CatalogueSort = 'brand' | 'trade-desc' | 'trade-asc' | 'year-desc'

export interface CatalogueQuery {
  q?: string
  brand?: string
  /** Only pieces carrying a trade price. */
  sort?: CatalogueSort
  page?: number
  perPage?: number
}

export interface CataloguePage {
  items: CatalogueItem[]
  total: number
  page: number
  perPage: number
  brands: string[]
}

/**
 * What a trade partner may be shown.
 *
 * In stock only: reserved, sold and written-off are states of our business,
 * not offers, and a dealer enquiring about a watch that went yesterday is a
 * conversation nobody wants to have twice.
 *
 * And held somewhere we actually sell from. Status alone was not enough,
 * because "in transit" is not a status — it is a location, and a watch in a
 * courier's bag is IN_STOCK the whole way. So the catalogue was offering
 * pieces that were not in the building, which is the one promise a trade
 * list has to keep.
 *
 * The switch is the location's own `publishToStorefront`, which is what the
 * Shopify sync already reads, rather than a test on the location's type.
 * That choice is made in sellableFrom() and the reasoning carries here: a
 * bonded warehouse, a piece away at service and a consignment case in
 * somebody else's shop are the same question as transit, and only transit is
 * typed TRANSIT. A switch is also something the business can change without
 * an engineer.
 *
 * One function, because this read happens in three places — the page, its
 * count, and the brand list behind the filter — and a list whose filter
 * offers a brand it will not then show is worse than either on its own.
 */
function offerable() {
  return [
    isNull(watches.deletedAt),
    eq(watches.status, 'IN_STOCK'),
    eq(locations.publishToStorefront, true),
  ]
}

export async function getCatalogue(
  query: CatalogueQuery,
  currency: CurrencyCode,
  rates: RateTable,
): Promise<CataloguePage> {
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  const perPage = Math.min(100, Math.max(1, Math.trunc(query.perPage ?? 24)))

  const clauses = [...offerable()]
  if (query.brand) clauses.push(eq(brands.name, query.brand))
  if (query.q) {
    const needle = `%${query.q.trim()}%`
    const match = or(
      ilike(watches.model, needle),
      ilike(watches.nickname, needle),
      ilike(brands.name, needle),
      ilike(watches.dial, needle),
      ilike(watches.caseMaterial, needle),
    )
    if (match) clauses.push(match)
  }
  const where = and(...clauses)

  // Unpriced pieces sort to the end of a price sort rather than counting as
  // zero, which would put a wall of "on request" at the top of a list
  // somebody asked to see cheapest first.
  const order = (() => {
    switch (query.sort) {
      case 'trade-desc': return [sql`${watches.tradePriceGbp} DESC NULLS LAST`, asc(watches.model)]
      case 'trade-asc': return [sql`${watches.tradePriceGbp} ASC NULLS LAST`, asc(watches.model)]
      case 'year-desc': return [sql`${watches.year} DESC NULLS LAST`, asc(watches.model)]
      default: return [asc(brands.name), asc(watches.model)]
    }
  })()

  const [rows, totals, brandRows] = await Promise.all([
    db.select({
      id: watches.id,
      brandName: brands.name,
      model: watches.model,
      modelName: watches.nickname,
      year: watches.year,
      condition: watches.condition,
      boxPapers: watches.boxPapers,
      productType: watches.productType,
      caseSizeMm: watches.caseSizeMm,
      caseMaterial: watches.caseMaterial,
      dial: watches.dial,
      bracelet: watches.bracelet,
      movement: watches.movement,
      waterResistanceM: watches.waterResistanceM,
      description: watches.description,
      tradePriceGbp: watches.tradePriceGbp,
      estSaleGbp: watches.estSaleGbp,
    })
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .innerJoin(locations, eq(locations.id, watches.locationId))
      .where(where)
      .orderBy(...order)
      .limit(perPage)
      .offset((page - 1) * perPage),

    db.select({ count: sql<number>`count(*)::int` })
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .innerJoin(locations, eq(locations.id, watches.locationId))
      .where(where),

    db.selectDistinct({ name: brands.name })
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .innerJoin(locations, eq(locations.id, watches.locationId))
      .where(and(...offerable()))
      .orderBy(asc(brands.name)),
  ])

  // One query for the photographs rather than a join, so a watch with six of
  // them does not multiply its row six times and break the page count.
  const ids = rows.map((r) => r.id)
  //
  // A trade photograph wins where there is one. It is the same watch shot for
  // The published photograph leads, because it is the one that shows the
  // watch; the trade shot is offered behind it rather than instead of it.
  // Where a watch has no published photograph the trade shot stands in,
  // because a catalogue of empty plates is worse than a catalogue of
  // workbench pictures.
  //
  // Cards and documents are named out rather than left to sort order. They
  // were reachable here: a watch whose warranty card happened to sort first
  // put a serial and a dealer's stamp on the catalogue page.
  const images = ids.length === 0 ? [] : await db
    .select({
      watchId: watchImages.watchId,
      id: watchImages.id,
      sortOrder: watchImages.sortOrder,
      kind: watchImages.kind,
    })
    .from(watchImages)
    .where(and(
      inArray(watchImages.watchId, ids),
      inArray(watchImages.kind, ['TRADE', 'WATCH']),
    ))
    .orderBy(
      // Website photograph first. This used to lead with the trade shot on
      // the reasoning that a dealer wants the watch as it is rather than as
      // it is sold — but a trade shot is a record picture, taken on whatever
      // surface was to hand, and a grid of them reads as a different and
      // worse shop than the same stock photographed properly. The trade
      // shot is still here, one click behind the card.
      sql`${watchImages.kind} <> 'WATCH'`,
      asc(watchImages.sortOrder),
      asc(watchImages.createdAt),
    )
  const tradeIds = new Set(images.filter((i) => i.kind === 'TRADE').map((i) => i.id))
  const cover = new Map<string, string>()
  for (const image of images) if (!cover.has(image.watchId)) cover.set(image.watchId, image.id)

  /*
   * The trade shot, where there is one, carried separately.
   *
   * Only when it is not already the cover: a watch with no website
   * photograph falls back to its trade shot above, and offering "view
   * trade image" on a card that is showing exactly that is a control that
   * appears to do nothing.
   */
  const tradeShot = new Map<string, string>()
  for (const image of images) {
    if (!tradeIds.has(image.id)) continue
    if (!tradeShot.has(image.watchId)) tradeShot.set(image.watchId, image.id)
  }

  return {
    items: rows.map(({ tradePriceGbp, estSaleGbp, ...rest }) => ({
      ...rest,
      trade: tradePriceGbp === null ? null : fromBase(tradePriceGbp, currency, rates),
      retail: estSaleGbp === null ? null : fromBase(estSaleGbp, currency, rates),
      imageId: cover.get(rest.id) ?? null,
      tradeImageId: (() => {
        const shot = tradeShot.get(rest.id) ?? null
        return shot && shot !== cover.get(rest.id) ? shot : null
      })(),
    })),
    total: totals[0]?.count ?? 0,
    page,
    perPage,
    brands: brandRows.map((b) => b.name),
  }
}

/**
 * Just the brand names, for the filter that lives in the top bar.
 *
 * The bar is rendered by the layout, which has no page result to read them
 * off, and one `select distinct` is cheaper than moving the filter back down
 * into the page and losing the single bar it now sits in.
 */
export async function catalogueBrands(): Promise<string[]> {
  const rows = await db.selectDistinct({ name: brands.name })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .innerJoin(locations, eq(locations.id, watches.locationId))
    .where(and(...offerable()))
    .orderBy(asc(brands.name))
  return rows.map((row) => row.name)
}
