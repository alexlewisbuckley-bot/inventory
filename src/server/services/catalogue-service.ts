import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/server/db/client'
import { brands, locations, watchImages, watches } from '@/server/db/schema'
import { DIAL_SQL, FAMILY_SQL, MATERIAL_SQL } from '@/server/repositories/watch-sql'
import { fromBase, type RateTable } from '@/lib/currency'
import {
  BOX_PAPERS_LABELS, CONDITION_LABELS, MENS_MIN_MM, WEARS_LABELS, WOMENS_MAX_MM,
  type BoxPapers, type Condition, type CurrencyCode, type Wears,
} from '@/lib/enums'

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

/**
 * The questions a dealer asks, and only those.
 *
 * Deliberately a closed list rather than the inventory's filter engine.
 * That engine can express supplier, owner, location, cost and margin, and
 * this is the one read in the application whose audience is not us — a
 * generic filter here would be one forgotten exclusion away from
 * answering a question about our business. These are the same cuts the
 * trade room offers, which is the vocabulary dealers already use.
 */
export interface CatalogueQuery {
  q?: string
  brand?: string
  /** The model name — Daytona, Nautilus — read off the nickname. */
  family?: string
  dial?: string
  /** The metal, coarsened the way the inventory coarsens it. */
  material?: string
  /** MENS or WOMENS, read off the case size as the storefront reads it. */
  wears?: Wears
  /** Case size in millimetres, exactly. */
  size?: number
  year?: number
  condition?: Condition
  boxPapers?: BoxPapers
  /** Only pieces carrying a trade price. */
  sort?: CatalogueSort
  page?: number
  perPage?: number
}

/** One choice in a filter, with how much stock sits behind it. */
export interface FacetChoice {
  value: string
  label: string
  count: number
}

export interface CatalogueFacets {
  brands: FacetChoice[]
  families: FacetChoice[]
  dials: FacetChoice[]
  materials: FacetChoice[]
  wears: FacetChoice[]
  sizes: FacetChoice[]
  years: FacetChoice[]
  conditions: FacetChoice[]
  sets: FacetChoice[]
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
  if (query.family) clauses.push(sql`${FAMILY_SQL} = ${query.family}`)
  if (query.dial) clauses.push(sql`${DIAL_SQL} = ${query.dial}`)
  if (query.material) clauses.push(sql`${MATERIAL_SQL} = ${query.material}`)
  if (query.condition) clauses.push(eq(watches.condition, query.condition))
  if (query.boxPapers) clauses.push(eq(watches.boxPapers, query.boxPapers))
  if (query.size) clauses.push(eq(watches.caseSizeMm, query.size))
  if (query.year) clauses.push(eq(watches.year, query.year))
  /*
   * Worn by, read off the case size — the storefront's thresholds, so the
   * shop, the book and the catalogue sort the same watch the same way. A
   * piece with no case size matches neither: we do not know, and guessing
   * puts a man's watch in front of somebody shopping for their wife.
   */
  if (query.wears === 'WOMENS') {
    clauses.push(sql`${watches.caseSizeMm} is not null and ${watches.caseSizeMm} <= ${WOMENS_MAX_MM}`)
  }
  if (query.wears === 'MENS') {
    clauses.push(sql`${watches.caseSizeMm} is not null and ${watches.caseSizeMm} >= ${MENS_MIN_MM}`)
  }
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
/**
 * What there is to choose between, and how much sits behind each choice.
 *
 * One query, counted in memory, rather than nine grouped queries. The
 * catalogue is a few hundred rows and every facet has to be counted
 * against the *other* filters rather than its own — pick Rolex and the
 * dial counts should narrow, but the brand list must still offer Patek or
 * there is no way back. Nine round trips to say that is worse than one
 * read and some arithmetic.
 *
 * A choice is only offered where stock stands behind it, so the menus can
 * never promise an empty grid. Facets with one choice are left for the
 * component to hide: a menu with nothing to choose between is furniture.
 *
 * The row-level predicate below has to agree with the SQL in getCatalogue.
 * They are stated twice because one runs in Postgres over a page and the
 * other in JavaScript over the whole book, and a test pins the pairing.
 */
export async function catalogueFacets(query: CatalogueQuery): Promise<CatalogueFacets> {
  const rows = await db
    .select({
      brand: brands.name,
      // The fragments are untyped SQL, so the shape is declared here.
      family: sql<string | null>`${FAMILY_SQL}`,
      dial: sql<string | null>`${DIAL_SQL}`,
      material: sql<string | null>`${MATERIAL_SQL}`,
      size: watches.caseSizeMm,
      year: watches.year,
      condition: watches.condition,
      boxPapers: watches.boxPapers,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .innerJoin(locations, eq(locations.id, watches.locationId))
    .where(and(...offerable()))

  type Row = (typeof rows)[number]

  /** The same cuts as the SQL, one row at a time. */
  const tests: Record<keyof CatalogueFacets, (row: Row) => boolean> = {
    brands: (r) => !query.brand || r.brand === query.brand,
    families: (r) => !query.family || r.family === query.family,
    dials: (r) => !query.dial || r.dial === query.dial,
    materials: (r) => !query.material || r.material === query.material,
    sizes: (r) => !query.size || r.size === query.size,
    years: (r) => !query.year || r.year === query.year,
    conditions: (r) => !query.condition || r.condition === query.condition,
    sets: (r) => !query.boxPapers || r.boxPapers === query.boxPapers,
    wears: (r) => !query.wears || wearsOf(r.size).includes(query.wears),
  }

  /** Every filter except this one, so a menu always offers a way back. */
  const others = (self: keyof CatalogueFacets) => (row: Row) =>
    (Object.keys(tests) as Array<keyof CatalogueFacets>)
      .every((key) => key === self || tests[key](row))

  const tally = (
    self: keyof CatalogueFacets,
    pick: (row: Row) => Array<{ value: string; label: string }>,
  ): FacetChoice[] => {
    const counts = new Map<string, FacetChoice>()
    for (const row of rows.filter(others(self))) {
      for (const { value, label } of pick(row)) {
        const seen = counts.get(value)
        if (seen) seen.count += 1
        else counts.set(value, { value, label, count: 1 })
      }
    }
    return [...counts.values()]
  }

  const plain = (value: string | null) => (value ? [{ value, label: value }] : [])
  const byLabel = (a: FacetChoice, b: FacetChoice) => a.label.localeCompare(b.label)
  // Biggest first for the measurements: a dealer scanning sizes wants the
  // ones there is stock in, not the numeric order of a long tail.
  const byCount = (a: FacetChoice, b: FacetChoice) => b.count - a.count || a.label.localeCompare(b.label)

  return {
    brands: tally('brands', (r) => plain(r.brand)).sort(byLabel),
    families: tally('families', (r) => plain(r.family)).sort(byLabel),
    dials: tally('dials', (r) => plain(r.dial)).sort(byLabel),
    materials: tally('materials', (r) => plain(r.material)).sort(byLabel),
    wears: tally('wears', (r) => wearsOf(r.size).map((value) => ({
      value, label: WEARS_LABELS[value as keyof typeof WEARS_LABELS],
    }))).sort(byLabel),
    sizes: tally('sizes', (r) => (r.size ? [{ value: String(r.size), label: `${r.size}mm` }] : []))
      .sort((a, b) => Number(a.value) - Number(b.value)),
    years: tally('years', (r) => (r.year ? [{ value: String(r.year), label: String(r.year) }] : []))
      .sort((a, b) => Number(b.value) - Number(a.value)),
    conditions: tally('conditions', (r) => [{
      value: r.condition,
      label: CONDITION_LABELS[r.condition as Condition] ?? r.condition,
    }]).sort(byCount),
    sets: tally('sets', (r) => [{
      value: r.boxPapers,
      label: BOX_PAPERS_LABELS[r.boxPapers as BoxPapers] ?? r.boxPapers,
    }]).sort(byCount),
  }
}

/**
 * Who a case size is for. Both, neither, or one — the bands overlap at
 * 35-37mm because that is a size either side of the house buys, and a
 * watch with no size recorded is nobody's until somebody measures it.
 */
function wearsOf(size: number | null): string[] {
  if (size === null) return []
  const out: string[] = []
  if (size <= WOMENS_MAX_MM) out.push('WOMENS')
  if (size >= MENS_MIN_MM) out.push('MENS')
  return out
}

export async function catalogueBrands(): Promise<string[]> {
  const rows = await db.selectDistinct({ name: brands.name })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .innerJoin(locations, eq(locations.id, watches.locationId))
    .where(and(...offerable()))
    .orderBy(asc(brands.name))
  return rows.map((row) => row.name)
}
