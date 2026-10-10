import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { asc, eq, isNull } from 'drizzle-orm'
import { Download, Inbox, Plus } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { brands, locations, owners, suppliers } from '@/server/db/schema'
import { countUnpriced, findWatches, stockFacets, summariseInventory } from '@/server/repositories/watch-repository'
import { watchQuerySchema } from '@/lib/validation'
import {
  applyFilters, legacyClauses, parseFilters, toSearchParams, WATCH_FIELDS,
} from '@/lib/filters'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageActions } from '@/components/layout/PageActions'
import { FilterBar } from '@/components/ui/DataList'
import { ViewBar } from '@/components/ui/DataList'
import { AVAILABLE_QUERY, INVENTORY_VIEWS } from '@/components/inventory/views'
import { FindBar } from '@/components/inventory/FindBar'
import { listViews } from '@/server/services/views-service'
import { InventoryList } from '@/components/inventory/InventoryList'
import { customerOptions, openDealsByWatch } from '@/server/repositories/crm-repository'
import { WatchDrawer } from '@/components/inventory/WatchDrawer'
import { Card, StatCard, LinkButton, SkeletonTable } from '@/components/ui'
import { formatPct } from '@/lib/money'
import { formatBase, formatBaseSigned, isCurrency } from '@/lib/currency'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { BASE_CURRENCY, DEFAULT_DISPLAY_CURRENCY } from '@/lib/enums'
import { CAPABILITIES, can, canSeeCost, type Capability } from '@/lib/permissions'
import { redactRows } from '@/server/redact'

export const metadata: Metadata = { title: 'Inventory' }
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

/** Normalise Next's searchParams into the shape the Zod query schema expects. */
function parseQuery(searchParams: SearchParams) {
  const multi = (key: string): string[] | undefined => {
    const value = searchParams[key]
    if (value === undefined) return undefined
    return Array.isArray(value) ? value : [value]
  }
  return watchQuerySchema.parse({
    q: searchParams.q,
    status: multi('status'),
    locationId: multi('locationId'),
    supplierId: multi('supplierId'),
    brandId: multi('brandId'),
    unpricedOnly: searchParams.unpricedOnly,
    purchasedFrom: searchParams.purchasedFrom || undefined,
    purchasedTo: searchParams.purchasedTo || undefined,
    sort: searchParams.sort ?? 'stockNo',
    dir: searchParams.dir ?? 'desc',
    page: searchParams.page ?? 1,
    perPage: searchParams.perPage ?? 25,
    // The V2 grammar, parsed by the one parser that knows the rules. Anything
    // the URL says that the fields do not support is dropped here rather than
    // reaching the query builder.
    f: parseFilters(toSearchParams(searchParams), WATCH_FIELDS),
  })
}

export default async function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireCapability('watch:read')

  /**
   * A bare /inventory means stock you hold, not stock you have ever held.
   *
   * Done as a redirect rather than as a default applied when no status filter
   * is present, because a hidden default would make the URL stop describing
   * what is on the screen — and the view chips decide which one is lit by
   * comparing themselves against the URL, so a filter that is real but
   * invisible would leave every chip dark on the page you land on.
   *
   * Only a completely bare URL redirects. /inventory?supplierId=… is somebody
   * asking a specific question, and answering a different one would be wrong.
   */
  if (Object.keys(searchParams).length === 0) {
    redirect(`/inventory?${AVAILABLE_QUERY}`)
  }

  /**
   * An old link, answered in the grammar the list actually speaks.
   *
   * The V1 parameters still reach this page from bookmarks and from messages
   * people sent each other, and they filtered invisibly: narrowed list, no
   * chip, no view lit, nothing to click to widen it again. Rewriting them into
   * clauses and sending the reader on means the URL describes what is on the
   * screen, which is the whole reason the grammar exists.
   *
   * An explicit clause wins over a translated one, so a link carrying both
   * says what the person who wrote it meant.
   */
  const legacy = legacyClauses(toSearchParams(searchParams))
  if (legacy.keys.length > 0) {
    const params = toSearchParams(searchParams)
    for (const key of legacy.keys) params.delete(key)
    const merged = [...parseFilters(params, WATCH_FIELDS), ...legacy.clauses]
    const seen = new Set<string>()
    const kept = merged.filter((clause) => {
      const key = `${clause.field}:${clause.operator}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    redirect(`/inventory?${applyFilters(params, kept).toString()}`)
  }

  const query = parseQuery(searchParams)

  /**
   * Export what is on the screen, not everything ever bought.
   *
   * The route has always accepted the list's own query parameters; the button
   * never sent them, so "Export CSV" from the Sold view handed you the whole
   * book. Now that the two views people work from are stock-you-hold and
   * sold, exporting the wrong one of them silently is the difference between
   * a stock take and a nonsense.
   *
   * `page` is dropped: which page you happened to be on is not part of what
   * you are looking at, and the export pages through the whole result anyway.
   */
  const exportHref = (() => {
    const params = toSearchParams(searchParams)
    for (const key of ['page', 'watch', 'cols']) params.delete(key)
    const qs = params.toString()
    return qs ? `/api/export/watches?${qs}` : '/api/export/watches'
  })()


  const [
    result, summary, locationOptions, ownerOptions, supplierOptions, brandOptions, rates, preferences,
    unpricedCount, customers, dealsByWatch, savedViews, facets,
  ] = await Promise.all([
    findWatches(query),
    summariseInventory(query),
    db.select({ id: locations.id, name: locations.name }).from(locations)
      .where(isNull(locations.deletedAt)).orderBy(asc(locations.sortOrder)),
    db.select({ id: owners.id, name: owners.name }).from(owners)
      .where(isNull(owners.deletedAt)).orderBy(asc(owners.sortOrder)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)
      .where(isNull(suppliers.deletedAt)).orderBy(asc(suppliers.name)),
    db.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name)),
    getRateTable(),
    getPreferencesFor(user.id),
    countUnpriced(),
    // Loaded with the page so the sell form can attribute a sale to a real
    // customer, and close the deal it came from, without a round trip.
    can(user.role, 'customer:read') ? customerOptions() : Promise.resolve([]),
    can(user.role, 'deal:read') ? openDealsByWatch() : Promise.resolve({}),
    listViews('watch', user.id),
    // Alongside the list rather than after it: the counts are of the same
    // query, so one round trip answers both and the bar cannot be a moment
    // out of date with the rows underneath it.
    stockFacets(query),
  ])

  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : DEFAULT_DISPLAY_CURRENCY
  const money = (base: number | null) => formatBase(base, currency, rates)

  // Money the reader may not see is removed here, before render — not hidden
  // by the table. Hidden is still in the payload, and the payload is the
  // thing that leaks.
  const showCost = canSeeCost(user.role)
  const showRevenue = can(user.role, 'revenue:read')
  const rows = redactRows(user.role as never, result.items, {
    cost: ['purchasePriceGbp', 'estProfitGbp', 'actualProfitGbp'],
    revenue: ['estSaleGbp', 'soldAmountGbp'],
  })

  // Resolved once server-side so the client never re-derives permissions.
  const capabilities = Object.fromEntries(
    CAPABILITIES.map((c) => [c, can(user.role, c)]),
  ) as Record<Capability, boolean>

  // A margin is profit over the cost of the stock that earned it, which is
  // the priced stock — not the whole book. Dividing by the whole book makes
  // the figure drop every time somebody books in a watch they have not priced
  // yet, which is not a change in margin.
  const margin = summary.pricedCostGbp > 0 ? (summary.estProfitGbp / summary.pricedCostGbp) * 100 : null
  const tradeMargin = summary.tradeCostGbp > 0 ? (summary.tradeProfitGbp / summary.tradeCostGbp) * 100 : null
  const watchId = typeof searchParams.watch === 'string' ? searchParams.watch : null

  return (
    <>
      <PageHeader
        title="Stock Inventory"
        description={showCost
          ? `${summary.inStockCount} ${summary.inStockCount === 1 ? 'watch' : 'watches'} matching the current view · ${money(summary.totalCostGbp)} invested`
          : `${summary.inStockCount} ${summary.inStockCount === 1 ? 'watch' : 'watches'} matching the current view`}
        actions={
          <>
            {/* Visible from sm upwards; below that they fold into the overflow
                menu so the primary action is not buried under two lines of
                secondary buttons. */}
            <span className="hidden sm:contents">
              {/* One button, because from where somebody stands an invoice, a
                  spreadsheet and a batch of photographs are one errand: here
                  are some files, put them where they go. Three buttons was
                  the filing cabinet showing through. */}
              {(capabilities['data:import'] || capabilities['watch:update']) && (
                <LinkButton href="/inventory/add" variant="secondary" icon={<Inbox className="h-4 w-4" />}>
                  Bring stock in
                </LinkButton>
              )}
              {capabilities['report:export'] && (
                <LinkButton href={exportHref} variant="secondary" icon={<Download className="h-4 w-4" />}>
                  Export
                </LinkButton>
              )}
            </span>
            <PageActions
              secondary={[
                ...(capabilities['data:import'] || capabilities['watch:update']
                  ? [{ id: 'add', label: 'Bring stock in', href: '/inventory/add', icon: <Inbox className="h-3.5 w-3.5" /> }]
                  : []),

              ]}
              primary={capabilities['watch:create']
                ? <LinkButton href="/inventory/new" icon={<Plus className="h-4 w-4" />}>Add item</LinkButton>
                : undefined}
            />
          </>
        }
      />

      {/*
        Two books, not one.

        Retail and the trade are different prices to different buyers, so the
        same stock has two margins — and the question "what does this look
        like if it all goes to the trade" was being answered by discounting
        the retail figure in somebody's head. Each channel's value and its
        profit sit next to each other, with what the stock cost beside them.
      */}
      <section aria-label="Summary of the current view" className="mb-8 grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-3">
        <StatCard label="In view" value={summary.inStockCount} caption={`${summary.unpricedCount} without a price`} />
        {showRevenue && (
          <StatCard label="Retail value" value={money(summary.estSaleGbp)} caption={`${summary.pricedCount} priced`} />
        )}
        {showCost && (
          <StatCard
            label="Est. profit · Retail"
            value={formatBaseSigned(summary.estProfitGbp, currency, rates)}
            caption={margin !== null ? `${formatPct(margin)} on priced stock` : 'Nothing priced'}
            tone="accent"
          />
        )}
        {showCost && (
          <StatCard label="Capital invested" value={money(summary.totalCostGbp)} caption={`avg ${money(summary.avgCostGbp)} per watch`} />
        )}
        {showRevenue && (
          <StatCard
            label="Trade value"
            value={money(summary.tradeValueGbp)}
            caption={`${summary.tradePricedCount} quoted to the trade`}
          />
        )}
        {showCost && (
          <StatCard
            label="Est. profit · Trade"
            value={formatBaseSigned(summary.tradeProfitGbp, currency, rates)}
            caption={tradeMargin !== null ? `${formatPct(tradeMargin)} on trade-priced stock` : 'No trade prices yet'}
            tone="accent"
          />
        )}
      </section>

      <ViewBar object="watch" builtIn={INVENTORY_VIEWS} saved={savedViews} />

      <FilterBar
        fields={WATCH_FIELDS}
        placeholder="Search by stock number, model, reference or serial…"
        options={{
          locations: locationOptions.map((row) => ({ value: row.id, label: row.name })),
          owners: ownerOptions.map((row) => ({ value: row.id, label: row.name })),
          suppliers: supplierOptions.map((row) => ({ value: row.id, label: row.name })),
          brands: brandOptions.map((row) => ({ value: row.id, label: row.name })),
          // From the facets, so the menu offers exactly the families that are
          // in the case — and the same ones the bar above is showing.
          families: facets.families.map((option) => ({ value: option.value, label: option.label })),
        }}
      />

      {/* One row: the four questions, answered from what is in the case. */}
      <FindBar facets={facets} total={result.total} />

      <Card className="overflow-hidden">
        <Suspense fallback={<SkeletonTable rows={10} columns={9} />}>
          <InventoryList
            result={{ ...result, items: rows }}
            locations={locationOptions}
            capabilities={capabilities}
            customers={customers}
            dealsByWatch={dealsByWatch}
          />
        </Suspense>
      </Card>

      {watchId && <WatchDrawer watchId={watchId} capabilities={capabilities} />}
    </>
  )
}
