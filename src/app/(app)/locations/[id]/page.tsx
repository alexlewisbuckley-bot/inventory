import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound, redirect } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { locations } from '@/server/db/schema'
import { findWatches, summariseInventory } from '@/server/repositories/watch-repository'
import { watchQuerySchema } from '@/lib/validation'
import { parseFilters, toSearchParams, WATCH_FIELDS } from '@/lib/filters'
import { PageHeader } from '@/components/layout/PageHeader'
import { InventoryList } from '@/components/inventory/InventoryList'
import { AVAILABLE_QUERY, locationViews } from '@/components/inventory/views'
import { ViewBar } from '@/components/ui/DataList'
import { Card, LinkButton, SkeletonTable, StatCard } from '@/components/ui'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { formatBase, isCurrency } from '@/lib/currency'
import { DEFAULT_DISPLAY_CURRENCY, LOCATION_TYPE_LABELS, type LocationType } from '@/lib/enums'
import { CAPABILITIES, can, canSeeCost, type Capability } from '@/lib/permissions'
import { redactRows } from '@/server/redact'

export const metadata: Metadata = { title: 'Location' }
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

/**
 * One location, and the stock standing in it.
 *
 * This page exists because the stock list stopped carrying everything. Alex:
 * "if you make a way to hide from inventory (main dashboard) but trackable
 * only from locations that will be better ... the only way to view them is
 * through the location itself."
 *
 * So this is that way, and for the stock held abroad it is the only one. It
 * shows what is there whether or not the location is on the books here —
 * which is the whole point, and also why it asks for `location:manage` rather
 * than `location:read`. A salesperson has `location:read` so the Locations
 * page can tell them where a watch is; letting that same capability open the
 * Hong Kong vault would put the stock back in front of the one role Alex said
 * should not see it: "These should not be shown on the website, in trade
 * acounts or to the sales staff."
 */
export default async function LocationPage(
  { params, searchParams }: { params: { id: string }; searchParams: SearchParams },
) {
  const user = await requireCapability('location:manage')

  /*
   * What is here, not what has ever been here.
   *
   * Alex, on a sold Richard Mille still standing in "In transit": "If sold
   * remove from location and move out from view." It was in the list and its
   * £120,279 was inside "Capital held", which is the figure somebody reads to
   * know what is tied up in that place — so the page disagreed with the
   * locations index beside it, which has always counted live stock only.
   *
   * Done as a redirect rather than as a default applied when no status clause
   * is present, for the reason the stock list does it: a hidden default makes
   * the URL stop describing what is on the screen, and the chips below decide
   * which one is lit by comparing themselves against the URL. A clause
   * somebody can see is a clause they can take off.
   */
  if (Object.keys(searchParams).length === 0) {
    redirect(`/locations/${params.id}?${AVAILABLE_QUERY}`)
  }

  const [location] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.id, params.id), isNull(locations.deletedAt)))
    .limit(1)
  if (!location) notFound()

  /*
   * The location is fixed, whatever the URL says.
   *
   * Sorting, paging and the filter grammar all still work — this is the same
   * list component as the stock page — but the one clause that decides which
   * stock this page is allowed to show is set here and cannot be argued with.
   */
  const query = watchQuerySchema.parse({
    sort: searchParams.sort ?? 'stockNo',
    dir: searchParams.dir ?? 'desc',
    page: searchParams.page ?? 1,
    perPage: searchParams.perPage ?? 50,
    f: parseFilters(toSearchParams(searchParams), WATCH_FIELDS),
    locationId: [location.id],
  })

  const [result, summary, locationOptions, rates, preferences] = await Promise.all([
    findWatches(query, { heldAway: true }),
    summariseInventory(query, { heldAway: true }),
    db.select({ id: locations.id, name: locations.name }).from(locations)
      .where(isNull(locations.deletedAt)).orderBy(asc(locations.sortOrder)),
    getRateTable(),
    getPreferencesFor(user.id),
  ])

  const capabilities = Object.fromEntries(
    CAPABILITIES.map((c) => [c, can(user.role, c)]),
  ) as Record<Capability, boolean>

  const display = isCurrency(preferences.displayCurrency)
    ? preferences.displayCurrency
    : DEFAULT_DISPLAY_CURRENCY
  const money = (base: number) => formatBase(base, display, rates)

  const rows = redactRows(user.role as never, result.items, {
    cost: ['purchasePriceGbp', 'estProfitGbp', 'actualProfitGbp'],
  })

  /*
   * Which of the two the page is showing, so the figures say what they are.
   *
   * "Capital held" over a list of sold watches is not a smaller truth, it is
   * a wrong one: that money came back. And "Asking" is the price we were
   * asking, which is not what any of them made — that is on the sales ledger,
   * and the card says so rather than printing a number nobody should read.
   */
  const showingSold = (query.f ?? []).some(
    (clause) => clause.field === 'status' && clause.operator === 'is'
      && clause.values.includes('SOLD'),
  )

  return (
    <>
      <PageHeader
        title={location.name}
        description={[
          LOCATION_TYPE_LABELS[location.type as LocationType],
          location.city,
          location.country,
        ].filter(Boolean).join(' · ')}
        actions={
          <LinkButton href="/locations" variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>
            Locations
          </LinkButton>
        }
      />

      {!location.isOnHand && (
        /*
         * Said once, at the top, because somebody arriving here from the
         * stock list needs to know why these watches were not on it.
         */
        <Card className="mb-4 border-state-warning/40 bg-state-warning/5 px-5 py-4">
          <p className="text-small text-content-primary">
            <span className="font-semibold">Held away. </span>
            This stock is not on the main stock list, not on the website, not on the trade
            catalogue and not offered to partners. It is counted here and in the reports, and
            this page is where it is tracked from.
          </p>
        </Card>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard
          label={showingSold ? 'Sold from here' : 'Watches'}
          value={String(result.total)}
        />
        {canSeeCost(user.role) && (
          <StatCard
            label={showingSold ? 'What they cost' : 'Capital held'}
            value={money(summary.totalCostGbp)}
          />
        )}
        {capabilities['revenue:read'] && !showingSold && (
          <StatCard label="Asking" value={money(summary.estSaleGbp)} />
        )}
        {capabilities['revenue:read'] && showingSold && (
          <StatCard
            label="What they made"
            value="On the sales ledger"
            caption="This page knows the asking price, not the invoice"
          />
        )}
      </div>

      {/*
        Two chips, no saving.
        
        A view saved here would carry this location in its query and then
        offer itself on the stock list, where it would be a chip that empties
        the page — held-away stock is not on that list at all.
      */}
      <div className="mb-4">
        <ViewBar object="watch" builtIn={locationViews()} saved={[]} canSave={false} />
      </div>

      <Card>
        <Suspense fallback={<SkeletonTable rows={8} />}>
          <InventoryList
            result={{ ...result, items: rows }}
            locations={locationOptions}
            capabilities={capabilities}
          />
        </Suspense>
      </Card>
    </>
  )
}
