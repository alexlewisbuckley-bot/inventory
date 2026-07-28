import type { Metadata } from 'next'
import { Suspense } from 'react'
import { asc, eq, isNull } from 'drizzle-orm'
import { Download, Plus, Upload } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { brands, locations, suppliers } from '@/server/db/schema'
import { countUnpriced, findWatches, summariseInventory } from '@/server/repositories/watch-repository'
import { watchQuerySchema } from '@/lib/validation'
import { PageHeader } from '@/components/layout/PageHeader'
import { FilterBar } from '@/components/inventory/FilterBar'
import { SavedViews } from '@/components/inventory/SavedViews'
import { InventoryTable } from '@/components/inventory/InventoryTable'
import { WatchDrawer } from '@/components/inventory/WatchDrawer'
import { Card, StatCard, LinkButton, SkeletonTable } from '@/components/ui'
import { formatPct } from '@/lib/money'
import { formatBase, formatBaseSigned, isCurrency } from '@/lib/currency'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { BASE_CURRENCY } from '@/lib/enums'
import { CAPABILITIES, can, type Capability } from '@/lib/permissions'

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
  })
}

export default async function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireCapability('watch:read')
  const query = parseQuery(searchParams)

  const [result, summary, locationOptions, supplierOptions, brandOptions, rates, preferences, unpricedCount] = await Promise.all([
    findWatches(query),
    summariseInventory(query),
    db.select({ id: locations.id, name: locations.name }).from(locations)
      .where(isNull(locations.deletedAt)).orderBy(asc(locations.sortOrder)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)
      .where(isNull(suppliers.deletedAt)).orderBy(asc(suppliers.name)),
    db.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name)),
    getRateTable(),
    getPreferencesFor(user.id),
    countUnpriced(),
  ])

  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : BASE_CURRENCY
  const money = (base: number | null) => formatBase(base, currency, rates)

  // Resolved once server-side so the client never re-derives permissions.
  const capabilities = Object.fromEntries(
    CAPABILITIES.map((c) => [c, can(user.role, c)]),
  ) as Record<Capability, boolean>

  const margin = summary.totalCostGbp > 0 ? (summary.estProfitGbp / summary.totalCostGbp) * 100 : null
  const watchId = typeof searchParams.watch === 'string' ? searchParams.watch : null

  return (
    <>
      <PageHeader
        title="Stock Inventory"
        description={`${summary.inStockCount} ${summary.inStockCount === 1 ? 'watch' : 'watches'} matching the current view · ${money(summary.totalCostGbp)} invested`}
        actions={
          <>
            {capabilities['data:import'] && (
              <LinkButton href="/inventory/import" variant="ghost" icon={<Upload className="h-4 w-4" />}>
                Import
              </LinkButton>
            )}
            {capabilities['report:export'] && (
              <LinkButton href="/api/export/watches" variant="secondary" icon={<Download className="h-4 w-4" />}>
                Export CSV
              </LinkButton>
            )}
            {capabilities['watch:create'] && (
              <LinkButton href="/inventory/new" icon={<Plus className="h-4 w-4" />}>Add watch</LinkButton>
            )}
          </>
        }
      />

      <section aria-label="Summary of the current view" className="mb-8 grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-4">
        <StatCard label="In view" value={summary.inStockCount} caption={`${summary.unpricedCount} without a price`} />
        <StatCard label="Capital invested" value={money(summary.totalCostGbp)} caption={`avg ${money(summary.avgCostGbp)} per watch`} />
        <StatCard label="Est. sale value" value={money(summary.estSaleGbp)} caption={`${summary.pricedCount} priced`} />
        <StatCard
          label="Est. profit"
          value={formatBaseSigned(summary.estProfitGbp, currency, rates)}
          caption={margin !== null ? `${formatPct(margin)} on priced stock` : '—'}
          tone="accent"
        />
      </section>

      <SavedViews counts={{ unpriced: unpricedCount }} />

      <FilterBar locations={locationOptions} suppliers={supplierOptions} brands={brandOptions} />

      <Card className="overflow-hidden">
        <Suspense fallback={<SkeletonTable rows={10} columns={9} />}>
          <InventoryTable result={result} locations={locationOptions} capabilities={capabilities} />
        </Suspense>
      </Card>

      {watchId && <WatchDrawer watchId={watchId} capabilities={capabilities} />}
    </>
  )
}
