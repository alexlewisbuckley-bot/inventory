import { and, asc, count, desc, eq, gte, inArray, isNull, isNotNull, like, lte, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { liveSale } from '../db/predicates'
import {
  brands, locations, owners, purchaseInvoices, sales, suppliers, users, watchImages, watches,
} from '../db/schema'
import { alias } from 'drizzle-orm/pg-core'
import { filtersToSql, type ColumnMap } from './filter-sql'
import { WATCH_FIELDS } from '@/lib/filters'
import {
  BUDGET_BANDS, HELD_STATUSES, MENS_MIN_MM, SIZE_BANDS, WEARS, WEARS_LABELS,
  WOMENS_MAX_MM, type Wears,
} from '@/lib/enums'
import { budgetBandLabel } from '@/lib/filters'

/**
 * The family a watch belongs to, read off its nickname, as SQL.
 *
 * Two cuts, and the order matters.
 *
 * First everything from a quote or a dash onward, because a nickname is a
 * family plus the name the trade gave one version of it: Submariner
 * "Hulk", Submariner "Starbucks", GMT-Master II "Root Beer". Left whole,
 * every nicknamed watch becomes its own family of one and the Model row
 * turns into a list of individual watches — measured on the seed, eight
 * families for fifteen named watches, which is a menu that answers no
 * question. Cut, they collect under Submariner, where somebody asking for
 * a Submariner will find them.
 *
 * Then a trailing case size, 20 to 60: a Datejust 41 and a Datejust 31 are
 * one family in two sizes, and the size has a row of its own. Bounded,
 * because a bare trailing-number rule reads "RM 011" as an RM in 11mm and
 * files a Richard Mille under "RM".
 *
 * This goes one step further than `familyOf` in shopify-map, which only
 * takes the size off. That is not drift: familyOf feeds the shop's model
 * list, and the storefront makes the same quote cut itself in famOf when it
 * builds its menu. The customer sees the same grouping either way; this is
 * the first place the trade side has had it.
 */
const FAMILY_SQL = sql`nullif(btrim(regexp_replace(regexp_replace(${watches.nickname}, '\\s*[“”"–—].*$', ''), '\\s+(2[0-9]|[3-5][0-9]|60)(\\s*mm)?$', '', 'i')), '')`
import type { WatchQuery } from '@/lib/validation'
import type {
  EntityType, IdCheckStatus, ProductType, RegisterCheckStatus, VatCheckStatus, WatchStatus,
} from '@/lib/enums'

/**
 * Read model for the inventory list.
 *
 * Joined columns are flattened here so the UI never has to reach through
 * nested relations, and derived money figures are computed once server-side.
 */
export interface WatchListItem {
  id: string
  stockNo: number
  /** Nearly always WATCH; carried so the rare piece is visible in the list. */
  productType: ProductType
  brandName: string
  model: string
  nickname: string | null
  serial: string | null
  supplierName: string
  supplierId: string
  locationName: string
  ownerId: string | null
  ownerName: string | null
  year: number | null
  condition: string
  boxPapers: string
  caseSizeMm: number | null
  caseMaterial: string | null
  dial: string | null
  bracelet: string | null
  movement: string | null
  waterResistanceM: number | null
  description: string | null
  locationId: string
  purchaseDate: Date
  purchasePriceGbp: number
  purchasePriceUsd: number | null
  estSaleUsd: number | null
  /** Retail price in base minor units — what every other figure derives from. */
  estSaleGbp: number | null
  /** What the trade pays, base minor units. Null when not offered. */
  tradePriceGbp: number | null
  estSaleCurrency: string
  /** Estimated profit in GBP minor units; null when the watch is unpriced. */
  estProfitGbp: number | null
  /** Retained for the legacy USD columns in exports. */
  estProfitUsd: number | null
  status: WatchStatus
  version: number
  deletedAt: Date | null
  /**
   * What the watch actually sold for, and the profit realised, both in GBP
   * minor units. These were carried as the USD columns and then rendered
   * through the GBP formatter, which inflated every sold row by the exchange
   * rate — a watch sold for £12,500 at £8,084 profit reported £10,752.
   */
  soldAmountGbp: number | null
  actualProfitGbp: number | null
  /**
   * Everything the compliance light needs, carried on the row.
   *
   * The VAT half belongs to the supplier and is joined in rather than looked
   * up per row: the alternative is one query per watch to colour a column, and
   * the join is already here for the supplier's name.
   */
  registerCheckStatus: RegisterCheckStatus
  registerCheckedAt: Date | null
  supplierVatNo: string | null
  supplierEntityType: EntityType
  supplierVatCheckStatus: VatCheckStatus
  supplierVatCheckedAt: Date | null
  supplierDirectorName: string | null
  supplierIdCheckStatus: IdCheckStatus
  supplierIdCheckedAt: Date | null
  supplierIdDocumentExpiresOn: string | null
  /** The photograph the gallery leads with, where the watch has one. */
  primaryImageId: string | null
  /** The trade shot, where one has been taken. Null is a gap, not an error. */
  tradeImageId: string | null
}

export interface WatchListResult {
  items: WatchListItem[]
  total: number
  page: number
  perPage: number
  pages: number
}

/** Columns selected for the list view — kept narrow to avoid over-fetching. */
const listSelection = {
  id: watches.id,
  stockNo: watches.stockNo,
  productType: watches.productType,
  model: watches.model,
  nickname: watches.nickname,
  serial: watches.serial,
  purchaseDate: watches.purchaseDate,
  purchasePriceGbp: watches.purchasePriceGbp,
  purchasePriceUsd: watches.purchasePriceUsd,
  estSaleUsd: watches.estSaleUsd,
  estSaleGbp: watches.estSaleGbp,
  tradePriceGbp: watches.tradePriceGbp,
  estSaleCurrency: watches.estSaleCurrency,
  status: watches.status,
  version: watches.version,
  deletedAt: watches.deletedAt,
  brandName: brands.name,
  supplierName: suppliers.name,
  supplierId: suppliers.id,
  locationName: locations.name,
  locationId: locations.id,
  ownerId: watches.ownerId,
  ownerName: owners.name,
  year: watches.year,
  condition: watches.condition,
  boxPapers: watches.boxPapers,
  caseSizeMm: watches.caseSizeMm,
  caseMaterial: watches.caseMaterial,
  dial: watches.dial,
  bracelet: watches.bracelet,
  movement: watches.movement,
  waterResistanceM: watches.waterResistanceM,
  description: watches.description,
  soldAmountGbp: sales.saleAmountGbp,
  actualProfitGbp: sales.profitGbp,
  registerCheckStatus: watches.registerCheckStatus,
  registerCheckedAt: watches.registerCheckedAt,
  supplierVatNo: suppliers.vatNo,
  supplierEntityType: suppliers.entityType,
  supplierVatCheckStatus: suppliers.vatCheckStatus,
  supplierVatCheckedAt: suppliers.vatCheckedAt,
  supplierDirectorName: suppliers.directorName,
  supplierIdCheckStatus: suppliers.idCheckStatus,
  supplierIdCheckedAt: suppliers.idCheckedAt,
  supplierIdDocumentExpiresOn: suppliers.idDocumentExpiresOn,
  /**
   * The photograph to lead with, as a correlated scalar rather than a join.
   *
   * A join would multiply the row out per image and need collapsing again; the
   * gallery only ever wants one. Ordered so a picture of the watch beats a
   * scan of its warranty card — kind cannot be sorted alphabetically for this,
   * because CARD and DOCUMENT both sort before WATCH — then by the order
   * somebody arranged them in. Covered by watch_images_watch_idx.
   */
  primaryImageId: sql<string | null>`(
    SELECT wi.id FROM ${watchImages} wi
    WHERE wi.watch_id = ${watches.id}
    ORDER BY (wi.kind <> 'WATCH'), wi.sort_order, wi.created_at
    LIMIT 1
  )`,
  /**
   * The trade shot, fetched beside the other one rather than instead of it.
   *
   * Both come back on every row so the toggle in the gallery is a change of
   * mind rather than a round trip — and so that a watch with no trade shot
   * can say so, which is the thing somebody checking their trade photography
   * actually wants to see. Two correlated scalars on an indexed column is a
   * cheaper price than reloading the page to answer the same question.
   */
  tradeImageId: sql<string | null>`(
    SELECT wi.id FROM ${watchImages} wi
    WHERE wi.watch_id = ${watches.id} AND wi.kind = 'TRADE'
    ORDER BY wi.sort_order, wi.created_at
    LIMIT 1
  )`,
} as const

function buildFilters(query: WatchQuery): SQL | undefined {
  const clauses: (SQL | undefined)[] = []

  if (!query.includeDeleted) clauses.push(isNull(watches.deletedAt))

  if (query.q) {
    // Free-text across the identifiers staff actually quote to each other:
    // stock number, model reference, serial and nickname.
    const term = `%${query.q.toLowerCase()}%`
    clauses.push(
      or(
        like(sql`lower(${watches.model})`, term),
        like(sql`lower(${watches.serial})`, term),
        like(sql`lower(${watches.nickname})`, term),
        like(sql`lower(${brands.name})`, term),
        like(sql`cast(${watches.stockNo} as text)`, term),
      ),
    )
  }

  if (query.status?.length) clauses.push(inArray(watches.status, query.status))
  if (query.locationId?.length) clauses.push(inArray(watches.locationId, query.locationId))
  if (query.supplierId?.length) clauses.push(inArray(watches.supplierId, query.supplierId))
  if (query.brandId?.length) clauses.push(inArray(watches.brandId, query.brandId))
  // "Needs a price" means stock we hold with no asking price on it.
  //
  // Both halves of that were missing. There was no status filter at all, so
  // every link that carried this parameter — the sidebar's Unpriced stock,
  // the insight's "Price them", the reports page — opened a list with every
  // sold and written-off watch in it, while the count printed beside the link
  // had counted held stock only. The number said seven and the list showed
  // forty, which reads as the number being wrong.
  //
  // And a retail price of zero is not a price. It is what an import leaves
  // behind, the dashboard has always counted it as unpriced, and the Shopify
  // mirror already refuses to publish one — only this list disagreed.
  if (query.unpricedOnly) {
    clauses.push(inArray(watches.status, [...HELD_STATUSES]))
    clauses.push(or(isNull(watches.estSaleGbp), eq(watches.estSaleGbp, 0)))
  }
  if (query.purchasedFrom) clauses.push(gte(watches.purchaseDate, query.purchasedFrom))
  if (query.purchasedTo) clauses.push(lte(watches.purchaseDate, query.purchasedTo))
  if (query.minPriceGbp !== undefined) clauses.push(gte(watches.purchasePriceGbp, Math.round(query.minPriceGbp * 100)))
  if (query.maxPriceGbp !== undefined) clauses.push(lte(watches.purchasePriceGbp, Math.round(query.maxPriceGbp * 100)))

  // The V2 filter grammar, alongside the V1 named parameters rather than
  // instead of them. Both write to the same URL and both narrow the same
  // query, so a bookmark from last month and a filter built this morning
  // compose rather than fighting. The named parameters go in E7, once nothing
  // is producing them.
  const grammar = filtersToSql(query.f ?? [], WATCH_COLUMNS, WATCH_FIELDS)
  if (grammar) clauses.push(grammar)

  const present = clauses.filter(Boolean) as SQL[]
  return present.length > 0 ? and(...present) : undefined
}

/**
 * Which column each filterable field means.
 *
 * The second gate on hostile input: a field with no entry here produces no SQL
 * at all. That is the difference between a filter that quietly does nothing
 * and a string interpolated into a query.
 */
const WATCH_COLUMNS: ColumnMap = {
  status: { column: watches.status, kind: 'enum' },
  productType: { column: watches.productType, kind: 'enum' },
  registerCheckStatus: { column: watches.registerCheckStatus, kind: 'enum' },
  condition: { column: watches.condition, kind: 'enum' },
  brandId: { column: watches.brandId, kind: 'enum' },
  locationId: { column: watches.locationId, kind: 'enum' },
  ownerId: { column: watches.ownerId, kind: 'enum' },
  supplierId: { column: watches.supplierId, kind: 'enum' },
  model: { column: watches.model, kind: 'text' },
  serial: { column: watches.serial, kind: 'text' },
  purchasePriceGbp: { column: watches.purchasePriceGbp, kind: 'money' },
  estSaleGbp: { column: watches.estSaleGbp, kind: 'money' },
  tradePriceGbp: { column: watches.tradePriceGbp, kind: 'money' },
  purchaseDate: { column: watches.purchaseDate, kind: 'date' },
  year: { column: watches.year, kind: 'number' },

  /**
   * Who the watch is for, measured rather than recorded.
   *
   * Overlapping on purpose, and the overlap is why this cannot be a CASE
   * expression returning one bucket per row: 35–37mm is worn by anyone and
   * has to answer yes to both questions. The thresholds are the storefront's,
   * so the shop and the book sort the same watch the same way.
   *
   * A piece with no case size matches neither. We do not know, and guessing
   * puts a man's watch in front of somebody shopping for their wife.
   */
  wears: {
    kind: 'derived',
    match: (value) => value === 'WOMENS'
      ? sql`${watches.caseSizeMm} is not null and ${watches.caseSizeMm} <= ${WOMENS_MAX_MM}`
      : value === 'MENS'
        ? sql`${watches.caseSizeMm} is not null and ${watches.caseSizeMm} >= ${MENS_MIN_MM}`
        : undefined,
  },

  /**
   * What the record is still missing, one condition per fact.
   *
   * Three unrelated columns, so this cannot be three clauses: the grammar
   * ANDs them, and a watch missing its owner OR its serial OR its VAT scheme
   * is what the queue means. Picking several here ORs them, which is also
   * what picking several of anything else means.
   */
  /**
   * The model family, read off the nickname.
   *
   * `model` holds the reference — 126334 — which is what a dealer files by;
   * a customer asks for a Datejust. The name lives in the nickname, with the
   * case size on the end, so the size comes off: a 41 and a 31 are one
   * family in two sizes and splitting them makes a menu of one-offs.
   *
   * Only a plausible case size comes off, 20 to 60. A bare trailing-number
   * rule reads "RM 011" as an RM in 11mm and files a Richard Mille under
   * "RM". Mirrors familyOf in shopify-map, which does the same job for the
   * storefront's brand menu — see FAMILY_SQL for why it is stated twice.
   */
  family: {
    kind: 'derived',
    match: (value) => sql`${FAMILY_SQL} = ${value}`,
  },

  /**
   * Budget, as a band rather than a ceiling.
   *
   * Upper bound exclusive, so no watch lands in two bands and gets counted
   * twice, and a watch with no asking price is in no band at all — you
   * cannot offer somebody a watch you have not priced.
   */
  budget: {
    kind: 'derived',
    match: (value) => {
      const band = BUDGET_BANDS.find((entry) => entry.value === value)
      if (!band) return undefined
      // Bands are written in whole pounds; the column is in pence.
      const floor = sql`${watches.estSaleGbp} >= ${band.min * 100}`
      return band.max === null
        ? sql`(${watches.estSaleGbp} is not null and ${floor})`
        : sql`(${watches.estSaleGbp} is not null and ${floor} and ${watches.estSaleGbp} < ${band.max * 100})`
    },
  },

  /** Case size, cut where the trade cuts it. Unmeasured is in no band. */
  size: {
    kind: 'derived',
    match: (value) => {
      const band = SIZE_BANDS.find((entry) => entry.value === value)
      if (!band) return undefined
      const floor = sql`${watches.caseSizeMm} >= ${band.min}`
      return band.max === null
        ? sql`(${watches.caseSizeMm} is not null and ${floor})`
        : sql`(${watches.caseSizeMm} is not null and ${floor} and ${watches.caseSizeMm} < ${band.max})`
    },
  },

  missing: {
    kind: 'derived',
    match: (value) => value === 'OWNER'
      ? sql`${watches.ownerId} is null`
      : value === 'SERIAL'
        ? sql`(${watches.serial} is null or btrim(${watches.serial}) = '')`
        : value === 'VAT'
          ? sql`${watches.vatScheme} = 'UNKNOWN'`
          : undefined,
  },
}

/**
 * What is in the case, counted the way somebody browsing would ask.
 *
 * FACETED, which is the whole of why this exists rather than a list of
 * hard-coded chips. Each group is counted under every OTHER filter that is
 * on, and never under its own. So choosing Rolex renarrows the models and
 * the budgets to Rolexes, while the brand row still shows Patek with its
 * count — because the one thing somebody does next after picking a brand is
 * change their mind about it, and a row that hid the alternatives would make
 * that a trip back through the menu.
 *
 * Two rules, both learned on the storefront and both about not wasting a
 * reader's attention:
 *
 *   - an option with nothing behind it is not shown. A chip that opens an
 *     empty list is worse than no chip, because it is a promise.
 *   - a group with one option is not a filter. It is a label that cannot be
 *     switched off, and it costs a row.
 *
 * One query per group rather than one clever query: there are a few hundred
 * watches and five groups, the planner answers each in milliseconds, and the
 * alternative is a single statement nobody can read or change.
 */
export interface FacetOption {
  value: string
  label: string
  count: number
}

export interface FacetGroup {
  /** The filter field this writes, so the bar does not need to know. */
  field: string
  label: string
  options: FacetOption[]
}

/** Below two options a group is a label, not a filter. */
const WORTH_SHOWING = 2

export async function stockFacets(query: WatchQuery): Promise<FacetGroup[]> {
  // The same query with one field's clauses lifted out, which is what makes
  // a count faceted rather than merely filtered.
  const without = (field: string): SQL | undefined => buildFilters({
    ...query,
    f: (query.f ?? []).filter((clause) => clause.field !== field),
  })

  const [brandRows, familyRows, budgetRow, sizeRow, wearsRow] = await Promise.all([
    db.select({ value: brands.id, label: brands.name, count: count() })
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(without('brandId'))
      .groupBy(brands.id, brands.name),

    db.select({ value: sql<string>`${FAMILY_SQL}`, count: count() })
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(and(without('family'), sql`${FAMILY_SQL} is not null`))
      .groupBy(FAMILY_SQL),

    // The bands come back as one row of counts rather than one row each: a
    // GROUP BY would drop an empty band silently, and the difference between
    // "no watches under five" and "that band does not exist" is one the bar
    // has to be able to tell.
    db.select(Object.fromEntries(BUDGET_BANDS.map((band) => [
      band.value,
      sql<number>`count(*) filter (where ${WATCH_COLUMNS.budget.kind === 'derived'
        ? WATCH_COLUMNS.budget.match(band.value) ?? sql`false`
        : sql`false`})`,
    ])) as Record<string, SQL<number>>)
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(without('budget')),

    db.select(Object.fromEntries(SIZE_BANDS.map((band) => [
      band.value,
      sql<number>`count(*) filter (where ${WATCH_COLUMNS.size.kind === 'derived'
        ? WATCH_COLUMNS.size.match(band.value) ?? sql`false`
        : sql`false`})`,
    ])) as Record<string, SQL<number>>)
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(without('size')),

    db.select(Object.fromEntries(WEARS.map((value) => [
      value,
      sql<number>`count(*) filter (where ${WATCH_COLUMNS.wears.kind === 'derived'
        ? WATCH_COLUMNS.wears.match(value) ?? sql`false`
        : sql`false`})`,
    ])) as Record<string, SQL<number>>)
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(without('wears')),
  ])

  const rank = (options: FacetOption[]) => options
    .filter((option) => option.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  // Bands keep the order they are declared in — a budget row running
  // cheapest to dearest is a scale, and sorting it by popularity would make
  // it a list of numbers in no order at all.
  const banded = <T extends { value: string }>(
    bands: readonly T[],
    row: Record<string, unknown> | undefined,
    label: (band: T) => string,
  ): FacetOption[] => bands
    .map((band) => ({ value: band.value, label: label(band), count: Number(row?.[band.value] ?? 0) }))
    .filter((option) => option.count > 0)

  const groups: FacetGroup[] = [
    { field: 'brandId', label: 'Brand', options: rank(brandRows.map((r) => ({ value: r.value, label: r.label, count: Number(r.count) }))) },
    { field: 'family', label: 'Model', options: rank(familyRows.map((r) => ({ value: r.value, label: r.value, count: Number(r.count) }))) },
    { field: 'budget', label: 'Budget', options: banded(BUDGET_BANDS, budgetRow[0], budgetBandLabel) },
    { field: 'size', label: 'Case size', options: banded(SIZE_BANDS, sizeRow[0], (band) => band.label) },
    { field: 'wears', label: 'Worn by', options: banded(WEARS.map((value) => ({ value })), wearsRow[0], (band) => WEARS_LABELS[band.value as Wears]) },
  ]

  return groups.filter((group) => group.options.length >= WORTH_SHOWING)
}

function buildOrder(query: WatchQuery): SQL {
  const direction = query.dir === 'asc' ? asc : desc
  switch (query.sort) {
    case 'model': return direction(watches.model)
    case 'purchaseDate': return direction(watches.purchaseDate)
    case 'purchasePriceGbp': return direction(watches.purchasePriceGbp)
    // Sorts by the base column, which is the figure the column displays. The
    // key keeps its old name because it appears in saved-view URLs, but the
    // retained USD column it was named after holds the dollar figure as at the
    // purchase date, so ordering by it put the rows in an order that did not
    // match the numbers on screen.
    case 'estSaleUsd': return direction(watches.estSaleGbp)
    // NULLS LAST both ways: stock never offered to the trade belongs at the
    // end of the list whether the sort is high-to-low or low-to-high, not
    // treated as free at one end of it.
    case 'tradePriceGbp': return query.dir === 'asc'
      ? sql`${watches.tradePriceGbp} ASC NULLS LAST`
      : sql`${watches.tradePriceGbp} DESC NULLS LAST`
    // NULLS LAST both ways, as with trade: a piece whose year was never
    // recorded is unknown, not old and not new, so it belongs at the end of
    // the list either way rather than being sorted as year zero.
    case 'year': return query.dir === 'asc'
      ? sql`${watches.year} ASC NULLS LAST`
      : sql`${watches.year} DESC NULLS LAST`
    case 'status': return direction(watches.status)
    case 'location': return direction(locations.name)
    case 'owner': return direction(owners.name)
    // Sorting by margin needs the derived expression, not a stored column.
    case 'margin': return direction(sql`(${watches.estSaleGbp} - ${watches.purchasePriceGbp})`)
    case 'stockNo':
    default: return direction(watches.stockNo)
  }
}

/** Paginated, filtered, sorted inventory list. */
export async function findWatches(query: WatchQuery): Promise<WatchListResult> {
  const where = buildFilters(query)
  const offset = (query.page - 1) * query.perPage

  const [rows, totals] = await Promise.all([
    db.select(listSelection)
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .innerJoin(suppliers, eq(suppliers.id, watches.supplierId))
      .innerJoin(locations, eq(locations.id, watches.locationId))
      // Left, not inner: ownership is optional and an inner join would drop
      // every watch nobody has claimed yet straight off the stock list.
      .leftJoin(owners, eq(owners.id, watches.ownerId))
      .leftJoin(sales, and(eq(sales.watchId, watches.id), liveSale()))
      .where(where)
      .orderBy(buildOrder(query))
      .limit(query.perPage)
      .offset(offset),
    db.select({ value: count() })
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(where),
  ])

  const total = Number(totals[0]?.value ?? 0)
  return {
    items: rows.map((row) => ({
      ...row,
      status: row.status as WatchStatus,
      productType: row.productType as ProductType,
      // Kept for callers that still read it, derived from the base so it
      // cannot disagree with the profit shown beside it.
      estProfitUsd: row.estSaleGbp !== null
        ? row.estSaleGbp - row.purchasePriceGbp
        : null,
      estProfitGbp: row.estSaleGbp !== null
        ? row.estSaleGbp - row.purchasePriceGbp
        : null,
    })),
    total,
    page: query.page,
    perPage: query.perPage,
    pages: Math.max(1, Math.ceil(total / query.perPage)),
  }
}

/** Aggregate KPIs for the current filter set — the header stat tiles. */
export interface InventorySummary {
  inStockCount: number
  totalCostGbp: number
  totalCostUsd: number
  estSaleUsd: number
  estProfitUsd: number
  /** Aggregates in GBP minor units — the figures the UI converts for display. */
  estSaleGbp: number
  estProfitGbp: number
  pricedCount: number
  unpricedCount: number
  avgCostGbp: number
  /**
   * The same three figures for the trade.
   *
   * A different price to a different buyer, so a different margin: the number
   * that matters when the question is "what does this book look like if it
   * all goes to the trade" is not the retail one discounted in somebody's
   * head.
   */
  tradeValueGbp: number
  tradeProfitGbp: number
  tradePricedCount: number
  /**
   * What the priced stock cost, as against what all the stock cost.
   *
   * A margin is profit over the cost of the stock that earned it. Dividing by
   * the whole book understates it by however much unpriced stock is sitting
   * there, which is the difference between a true figure and one that moves
   * every time somebody books in a watch they have not priced yet — and the
   * caption has always said "on priced stock".
   */
  pricedCostGbp: number
  tradeCostGbp: number
}

export async function summariseInventory(query: WatchQuery): Promise<InventorySummary> {
  const where = buildFilters(query)
  const rows = await db
    .select({
      total: count(),
      cost: sql<number>`coalesce(sum(${watches.purchasePriceGbp}), 0)`,
      costUsd: sql<number>`coalesce(sum(${watches.purchasePriceGbp}), 0)`,
      sale: sql<number>`coalesce(sum(${watches.estSaleGbp}), 0)`,
      saleGbp: sql<number>`coalesce(sum(${watches.estSaleGbp}), 0)`,
      profitGbp: sql<number>`coalesce(sum(case when ${watches.estSaleGbp} is not null
        then ${watches.estSaleGbp} - ${watches.purchasePriceGbp} else 0 end), 0)`,
      priced: sql<number>`coalesce(sum(case when ${watches.estSaleGbp} is not null then 1 else 0 end), 0)`,
      // Only priced rows may contribute to estimated profit, otherwise the
      // figure silently understates by counting unpriced stock as zero revenue.
      profit: sql<number>`coalesce(sum(case when ${watches.estSaleGbp} is not null
        then ${watches.estSaleGbp} - coalesce(${watches.purchasePriceGbp}, 0) else 0 end), 0)`,
      pricedCost: sql<number>`coalesce(sum(case when ${watches.estSaleGbp} is not null
        then coalesce(${watches.purchasePriceGbp}, 0) else 0 end), 0)`,
      // The trade book: only rows actually quoted to the trade count, for the
      // same reason unpriced stock cannot count as zero revenue.
      tradeValue: sql<number>`coalesce(sum(${watches.tradePriceGbp}), 0)`,
      tradeProfit: sql<number>`coalesce(sum(case when ${watches.tradePriceGbp} is not null
        then ${watches.tradePriceGbp} - coalesce(${watches.purchasePriceGbp}, 0) else 0 end), 0)`,
      tradeCost: sql<number>`coalesce(sum(case when ${watches.tradePriceGbp} is not null
        then coalesce(${watches.purchasePriceGbp}, 0) else 0 end), 0)`,
      tradePriced: sql<number>`coalesce(sum(case when ${watches.tradePriceGbp} is not null then 1 else 0 end), 0)`,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(where)

  const row = rows[0]
  const total = Number(row?.total ?? 0)
  const cost = Number(row?.cost ?? 0)
  const priced = Number(row?.priced ?? 0)

  return {
    inStockCount: total,
    totalCostGbp: cost,
    totalCostUsd: Number(row?.costUsd ?? 0),
    estSaleUsd: Number(row?.sale ?? 0),
    estProfitUsd: Number(row?.profit ?? 0),
    estSaleGbp: Number(row?.saleGbp ?? 0),
    estProfitGbp: Number(row?.profitGbp ?? 0),
    pricedCount: priced,
    unpricedCount: total - priced,
    avgCostGbp: total > 0 ? Math.round(cost / total) : 0,
    tradeValueGbp: Number(row?.tradeValue ?? 0),
    tradeProfitGbp: Number(row?.tradeProfit ?? 0),
    tradePricedCount: Number(row?.tradePriced ?? 0),
    pricedCostGbp: Number(row?.pricedCost ?? 0),
    tradeCostGbp: Number(row?.tradeCost ?? 0),
  }
}

/** Full record for the detail drawer, including joined display names. */
/** A second handle on `users`, for the person who ran the register search. */
const registerChecker = alias(users, 'register_checker')

export async function findWatchById(id: string) {
  const rows = await db
    .select({
      watch: watches,
      brand: brands,
      supplier: suppliers,
      location: locations,
      owner: owners,
      sale: sales,
      createdByName: users.name,
      createdByInitials: users.initials,
      /** Who ran the register search, where one has been run. */
      registerCheckedByName: registerChecker.name,
      // The paperwork this watch was bought on, where it came in from one.
      invoice: {
        id: purchaseInvoices.id,
        invoiceNo: purchaseInvoices.invoiceNo,
        invoiceDate: purchaseInvoices.invoiceDate,
        fileName: purchaseInvoices.fileName,
        mimeType: purchaseInvoices.mimeType,
        byteSize: purchaseInvoices.byteSize,
      },
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .innerJoin(suppliers, eq(suppliers.id, watches.supplierId))
    .innerJoin(locations, eq(locations.id, watches.locationId))
    .leftJoin(owners, eq(owners.id, watches.ownerId))
    .innerJoin(users, eq(users.id, watches.createdById))
    .leftJoin(registerChecker, eq(registerChecker.id, watches.registerCheckedById))
    .leftJoin(sales, and(eq(sales.watchId, watches.id), liveSale()))
    .leftJoin(purchaseInvoices, eq(purchaseInvoices.id, watches.invoiceId))
    .where(eq(watches.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function findWatchByStockNo(stockNo: number) {
  const rows = await db.select().from(watches).where(eq(watches.stockNo, stockNo)).limit(1)
  return rows[0] ?? null
}

/** Next stock number, continuing the spreadsheet's sequence. */
export async function nextStockNo(): Promise<number> {
  const rows = await db.select({ max: sql<number>`coalesce(max(${watches.stockNo}), 1399)` }).from(watches)
  return Number(rows[0]?.max ?? 1399) + 1
}

/** Watches held longer than `days`, oldest first — the ageing report. */
export async function findAgeingStock(days: number, limit = 20) {
  const cutoff = new Date(Date.now() - days * 86_400_000)
  return db
    .select({
      id: watches.id, stockNo: watches.stockNo, model: watches.model,
      brandName: brands.name, purchaseDate: watches.purchaseDate,
      purchasePriceGbp: watches.purchasePriceGbp, locationName: locations.name,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .innerJoin(locations, eq(locations.id, watches.locationId))
    .where(and(
      isNull(watches.deletedAt),
      lte(watches.purchaseDate, cutoff),
      inArray(watches.status, ['IN_STOCK', 'RESERVED']),
    ))
    .orderBy(asc(watches.purchaseDate))
    .limit(limit)
}

/** Stock counts and capital grouped by location, for the dashboard. */
export async function stockByLocation() {
  return db
    .select({
      locationId: locations.id,
      locationName: locations.name,
      type: locations.type,
      count: count(watches.id),
      valueGbp: sql<number>`coalesce(sum(${watches.purchasePriceGbp}), 0)`,
    })
    .from(locations)
    .leftJoin(watches, and(
      eq(watches.locationId, locations.id),
      isNull(watches.deletedAt),
      inArray(watches.status, ['IN_STOCK', 'RESERVED', 'SALE_AGREED']),
    ))
    .where(isNull(locations.deletedAt))
    .groupBy(locations.id)
    .orderBy(asc(locations.sortOrder))
}

/** Watches with no estimated sale price — a data-quality worklist. */
export async function countUnpriced(): Promise<number> {
  const rows = await db.select({ value: count() }).from(watches)
    .where(and(isNull(watches.deletedAt), isNull(watches.estSaleGbp), inArray(watches.status, ['IN_STOCK', 'RESERVED'])))
  return Number(rows[0]?.value ?? 0)
}

export { isNotNull }
