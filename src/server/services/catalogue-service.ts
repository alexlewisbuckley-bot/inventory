import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/server/db/client'
import { brands, watchImages, watches } from '@/server/db/schema'
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
  imageId: string | null
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

export async function getCatalogue(
  query: CatalogueQuery,
  currency: CurrencyCode,
  rates: RateTable,
): Promise<CataloguePage> {
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  const perPage = Math.min(100, Math.max(1, Math.trunc(query.perPage ?? 24)))

  // In stock only. Reserved, sold and written-off are states of our business,
  // not offers, and a dealer enquiring about a watch that went yesterday is a
  // conversation nobody wants to have twice.
  const clauses = [isNull(watches.deletedAt), eq(watches.status, 'IN_STOCK')]
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
      .where(where)
      .orderBy(...order)
      .limit(perPage)
      .offset((page - 1) * perPage),

    db.select({ count: sql<number>`count(*)::int` })
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(where),

    db.selectDistinct({ name: brands.name })
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(and(isNull(watches.deletedAt), eq(watches.status, 'IN_STOCK')))
      .orderBy(asc(brands.name)),
  ])

  // One query for the photographs rather than a join, so a watch with six of
  // them does not multiply its row six times and break the page count.
  const ids = rows.map((r) => r.id)
  const images = ids.length === 0 ? [] : await db
    .select({ watchId: watchImages.watchId, id: watchImages.id, sortOrder: watchImages.sortOrder })
    .from(watchImages)
    .where(inArray(watchImages.watchId, ids))
    .orderBy(asc(watchImages.sortOrder), asc(watchImages.createdAt))
  const cover = new Map<string, string>()
  for (const image of images) if (!cover.has(image.watchId)) cover.set(image.watchId, image.id)

  return {
    items: rows.map(({ tradePriceGbp, estSaleGbp, ...rest }) => ({
      ...rest,
      trade: tradePriceGbp === null ? null : fromBase(tradePriceGbp, currency, rates),
      retail: estSaleGbp === null ? null : fromBase(estSaleGbp, currency, rates),
      imageId: cover.get(rest.id) ?? null,
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
    .where(and(isNull(watches.deletedAt), eq(watches.status, 'IN_STOCK')))
    .orderBy(asc(brands.name))
  return rows.map((row) => row.name)
}
