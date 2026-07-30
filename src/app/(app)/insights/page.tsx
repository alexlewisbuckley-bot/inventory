import type { Metadata } from 'next'
import Link from 'next/link'
import { and, desc, eq, isNull } from 'drizzle-orm'
import {
  AlertTriangle, ArrowRight, Banknote, Camera, Clock, Coins, Handshake,
  ImageOff, Package, PoundSterling, Receipt, ShoppingBag, TrendingUp, Truck, Upload,
} from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { liveSale } from '@/server/db/predicates'
import { brands, sales, watches } from '@/server/db/schema'
import { countUnpriced, findAgeingStock, stockByLocation, summariseInventory } from '@/server/repositories/watch-repository'
import {
  attentionCounts, capitalByBrand, recentIntake, salesComparison, stockAgeBuckets, stockFlow,
} from '@/server/repositories/dashboard-repository'
import { auditTrail } from '@/server/services/audit'
import { PageHeader } from '@/components/layout/PageHeader'
import { SellingInsightsPanel } from '@/components/insights/SellingInsights'
import { lostReasons, sellingInsights } from '@/server/repositories/insights-repository'
import { Card, CardHeader, EmptyState, LinkButton, Chip } from '@/components/ui'
import { MetricTile, percentChange } from '@/components/dashboard/MetricTile'
import { AttentionQueue, type AttentionItem } from '@/components/dashboard/AttentionQueue'
import { StockFlowChart } from '@/components/dashboard/StockFlowChart'
import { InventoryHealth } from '@/components/dashboard/InventoryHealth'
import { QuickActions, type QuickAction } from '@/components/dashboard/QuickActions'
import { formatPct } from '@/lib/money'
import { formatBase, formatBaseSigned, isCurrency } from '@/lib/currency'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { BASE_CURRENCY } from '@/lib/enums'
import { formatDate, relativeTime, daysHeld } from '@/lib/dates'
import { RelativeTime } from '@/components/ui/RelativeTime'
import { locationTypeCaption, AUDIT_ACTION_LABELS, type LocationType, type AuditAction } from '@/lib/enums'
import { watchQuerySchema } from '@/lib/validation'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Insights' }
export const dynamic = 'force-dynamic'

const AGEING_DAYS = 90
const WINDOW_DAYS = 30

export default async function InsightsPage() {
  // Guarded like the reports it absorbed: this screen is cost figures end to
  // end, and a role that may not see cost gets a refusal here rather than a
  // page of gaps.
  const user = await requireCapability('report:read')

  // Active stock only — sold and written-off watches are excluded from the
  // capital and margin figures so the tiles answer "what do we hold now?".
  const activeQuery = watchQuerySchema.parse({ status: ['IN_STOCK', 'RESERVED', 'SALE_AGREED'] })

  const [
    summary, byLocation, ageing, unpriced, recentSales, activity, rates, preferences,
    attention, buckets, flow, trading, intake, brandMix, selling, lost,
  ] = await Promise.all([
    summariseInventory(activeQuery),
    stockByLocation(),
    findAgeingStock(AGEING_DAYS, 4),
    countUnpriced(),
    db.select({
      id: sales.id, invoiceNo: sales.invoiceNo, saleDate: sales.saleDate,
      amountGbp: sales.saleAmountGbp, profitGbp: sales.profitGbp, marginBps: sales.marginBps,
      model: watches.model, stockNo: watches.stockNo, brandName: brands.name,
    })
      .from(sales)
      .innerJoin(watches, eq(watches.id, sales.watchId))
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(liveSale())
      .orderBy(desc(sales.saleDate))
      .limit(5),
    auditTrail({ perPage: 6, stockOnly: true }),
    getRateTable(),
    getPreferencesFor(user.id),
    attentionCounts(),
    stockAgeBuckets(),
    stockFlow(6),
    salesComparison(WINDOW_DAYS),
    recentIntake(WINDOW_DAYS),
    capitalByBrand(5),
    sellingInsights(),
    lostReasons(),
  ])

  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : BASE_CURRENCY
  const money = (base: number | null) => formatBase(base, currency, rates)
  const signed = (base: number | null) => formatBaseSigned(base, currency, rates)

  const marginOnPriced = summary.totalCostGbp > 0
    ? (summary.estProfitGbp / summary.totalCostGbp) * 100
    : null
  const realisedMargin = trading.revenueGbp > 0 ? (trading.profitGbp / trading.revenueGbp) * 100 : null
  const activeLocations = byLocation.filter((l) => l.count > 0).length
  const liveTotal = buckets.reduce((sum, b) => sum + b.count, 0)
  const topBrand = brandMix[0]
  const concentration = topBrand && summary.totalCostGbp > 0
    ? Math.round((topBrand.valueGbp / summary.totalCostGbp) * 100)
    : null

  const attentionItems: AttentionItem[] = [
    {
      id: 'unpriced',
      count: unpriced,
      title: unpriced === 1 ? 'watch has no sale price' : 'watches have no sale price',
      description: 'Unpriced stock is invisible to every margin forecast on this page.',
      href: '/inventory?unpricedOnly=true',
      cta: 'Set prices',
      severity: 'critical',
      icon: <AlertTriangle className="h-4 w-4" />,
    },
    {
      id: 'stale-commitment',
      count: attention.saleAgreedStale,
      title: attention.saleAgreedStale === 1 ? 'sale has been agreed for over a fortnight' : 'sales have been agreed for over a fortnight',
      description: 'A sale agreed but never invoiced is capital counted twice — confirm or release it.',
      href: '/inventory?status=SALE_AGREED',
      cta: 'Review',
      severity: 'critical',
      icon: <Handshake className="h-4 w-4" />,
    },
    {
      id: 'ageing',
      count: attention.ageing,
      title: attention.ageing === 1 ? 'watch has been held over 90 days' : 'watches have been held over 90 days',
      description: 'Long-held stock ties up capital and usually needs its price revisiting.',
      href: '/reports/ageing',
      cta: 'Review ageing',
      severity: 'warning',
      icon: <Clock className="h-4 w-4" />,
    },
    {
      id: 'reserved',
      count: attention.reservedStale,
      title: attention.reservedStale === 1 ? 'watch has been reserved for over a fortnight' : 'watches have been reserved for over a fortnight',
      description: 'A stale reservation blocks a sale to somebody else.',
      href: '/inventory?status=RESERVED',
      cta: 'Review',
      severity: 'warning',
      icon: <ShoppingBag className="h-4 w-4" />,
    },
    {
      id: 'rates',
      count: attention.staleRates,
      title: attention.staleRates === 1 ? 'exchange rate is over a month old' : 'exchange rates are over a month old',
      description: attention.oldestRateAt
        ? `Oldest rate was last set ${relativeTime(attention.oldestRateAt)}. Every converted figure depends on these.`
        : 'Every converted figure on this page depends on these.',
      href: '/settings/currencies',
      cta: 'Update rates',
      severity: 'warning',
      icon: <Coins className="h-4 w-4" />,
    },
    {
      id: 'images',
      count: attention.withoutImages,
      title: attention.withoutImages === 1 ? 'watch has no photographs' : 'watches have no photographs',
      description: 'Photographs of the watch and its card make listing and authentication quicker.',
      href: '/inventory',
      cta: 'Add photos',
      severity: 'info',
      icon: <ImageOff className="h-4 w-4" />,
    },
  ]

  const quickActions: QuickAction[] = [
    can(user.role, 'watch:create') && {
      href: '/inventory/new', label: 'Add a watch', hint: 'Book new stock in', icon: <Package className="h-4 w-4" />,
    },
    can(user.role, 'sale:create') && {
      href: '/inventory?status=SALE_AGREED', label: 'Mark one as sold', hint: 'Close an agreed deal', icon: <Receipt className="h-4 w-4" />,
    },
    can(user.role, 'watch:create') && {
      href: '/inventory/import', label: 'Import stock', hint: 'Bring in a spreadsheet', icon: <Upload className="h-4 w-4" />,
    },
    {
      href: '/reports', label: 'Open reports', hint: 'Margin, ageing and stock mix', icon: <TrendingUp className="h-4 w-4" />,
    },
  ].filter(Boolean) as QuickAction[]

  const flowPoints = flow.map((point) => ({
    month: point.month,
    label: point.label,
    boughtCount: point.boughtCount,
    boughtValue: money(point.boughtGbp),
    soldCount: point.soldCount,
    soldValue: money(point.soldGbp),
    profitValue: signed(point.profitGbp),
  }))

  const healthBuckets = buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: bucket.count,
    value: money(bucket.valueGbp),
    concerning: bucket.concerning,
    href: bucket.concerning ? '/reports/ageing' : '/inventory',
  }))

  return (
    <>
      <PageHeader
        title="Insights"
        description={describePosition(summary.inStockCount, activeLocations, trading.count, WINDOW_DAYS)}
        actions={can(user.role, 'watch:create')
          ? <LinkButton href="/inventory/new" icon={<span aria-hidden>+</span>}>Add watch</LinkButton>
          : undefined}
      />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MetricTile
          label="Capital invested"
          value={money(summary.totalCostGbp)}
          caption={`${summary.inStockCount} watches · avg ${money(summary.avgCostGbp)}`}
          icon={<PoundSterling className="h-4 w-4" />}
          href="/inventory"
        />
        <MetricTile
          label="Est. profit on stock"
          value={signed(summary.estProfitGbp)}
          tone="accent"
          caption={marginOnPriced !== null
            ? `${formatPct(marginOnPriced)} on ${summary.pricedCount} priced`
            : 'Nothing priced yet'}
          icon={<TrendingUp className="h-4 w-4" />}
          href="/reports"
        />
        <MetricTile
          label={`Sold · last ${WINDOW_DAYS} days`}
          value={money(trading.revenueGbp)}
          // A delta between two empty periods says nothing — the caption already does.
          delta={trading.revenueGbp > 0 || trading.previousRevenueGbp > 0
            ? { pct: percentChange(trading.revenueGbp, trading.previousRevenueGbp), label: `vs prior ${WINDOW_DAYS}d` }
            : undefined}
          caption={trading.count > 0
            ? `${trading.count} sold${realisedMargin !== null ? ` · ${formatPct(realisedMargin)} margin` : ''}`
            : 'No sales in this window'}
          icon={<Banknote className="h-4 w-4" />}
          href="/sales"
        />
        <MetricTile
          label={`Booked in · last ${WINDOW_DAYS} days`}
          value={intake.count}
          delta={intake.count > 0 || intake.previousCount > 0
            ? { pct: percentChange(intake.count, intake.previousCount), label: `vs prior ${WINDOW_DAYS}d` }
            : undefined}
          caption={`${money(intake.valueGbp)} of new stock`}
          icon={<Truck className="h-4 w-4" />}
          href="/inventory?sort=purchaseDate&dir=desc"
        />
      </section>

      {/* The selling questions, from stage events the product has recorded
          since the CRM shipped and aggregated for the first time here. Above
          the stock figures because the stock figures describe what is owned
          and these describe what is happening. */}
      <section aria-label="Selling" className="mt-8">
        <SellingInsightsPanel data={selling} lost={lost} money={money} />
      </section>

      <section aria-label="Quick actions" className="mt-4">
        <QuickActions actions={quickActions} />
      </section>

      <section className="mt-8 grid items-start gap-6 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          <AttentionQueue items={attentionItems} />
        </div>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader title="Stock health" description={`Age of the ${liveTotal} watches you hold`} />
          <InventoryHealth buckets={healthBuckets} total={liveTotal} />
        </Card>
      </section>

      <section className="mt-8 grid items-start gap-6 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader
            title="Stock flow"
            description="Watches bought against watches sold, by month"
            action={<Link href="/reports" className="text-small font-bold text-content-accent hover:underline">Reports</Link>}
          />
          <StockFlowChart data={flowPoints} />
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader
            title="Where capital sits"
            description={concentration !== null && topBrand
              ? `${concentration}% of it in ${topBrand.brandName}`
              : 'Across your locations'}
          />
          <ul className="divide-y divide-line-subtle">
            {byLocation.map((row) => {
              const share = summary.inStockCount > 0 ? (Number(row.count) / summary.inStockCount) * 100 : 0
              return (
                <li key={row.locationId} className="px-6 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-small font-bold text-content-primary">{row.locationName}</p>
                      {locationTypeCaption(row.locationName, row.type as LocationType) && (
                        <p className="text-caption text-content-secondary">
                          {locationTypeCaption(row.locationName, row.type as LocationType)}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-small font-bold tabular-nums text-content-primary">{Number(row.count)}</p>
                      <p className="text-caption tabular-nums text-content-secondary">{money(Number(row.valueGbp))}</p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-surface-subtle" role="presentation">
                    <div className="h-full rounded-pill bg-series-1" style={{ width: `${Math.max(share, share > 0 ? 4 : 0)}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
          {brandMix.length > 0 && (
            <div className="border-t border-line-subtle px-6 py-4">
              <p className="text-caption font-semibold text-content-secondary">By brand</p>
              <ul className="mt-2.5 space-y-1.5">
                {brandMix.map((brand) => (
                  <li key={brand.brandId} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-small text-content-primary">{brand.brandName}</span>
                    <span className="shrink-0 text-caption tabular-nums text-content-secondary">
                      {brand.count} · {money(brand.valueGbp)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </section>

      <section className="mt-8 grid items-start gap-6 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader
            title="Recent sales"
            description={trading.count > 0
              ? `${trading.count} in the last ${WINDOW_DAYS} days · ${signed(trading.profitGbp)} profit`
              : 'Nothing sold recently'}
            action={<Link href="/sales" className="text-small font-bold text-content-accent hover:underline">All sales</Link>}
          />
          {recentSales.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="h-6 w-6" />}
              title="No sales recorded yet"
              description="When you record a sale against a watch it will appear here with its realised margin."
            />
          ) : (
            <ul className="divide-y divide-line-subtle">
              {recentSales.map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-4 px-6 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-small font-bold text-content-primary">
                      {sale.brandName} {sale.model}
                    </p>
                    <p className="text-caption text-content-secondary">
                      Stock {sale.stockNo} · {sale.invoiceNo} · {formatDate(sale.saleDate)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-small font-bold tabular-nums text-content-primary">
                      {money(sale.amountGbp)}
                    </span>
                    <Chip tone={sale.profitGbp >= 0 ? 'accent' : 'danger'}>
                      {signed(sale.profitGbp)} · {formatPct(sale.marginBps / 100)}
                    </Chip>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="min-w-0">
          <CardHeader
            title={ageing.length > 0 ? 'Oldest stock' : 'Recent activity'}
            description={ageing.length > 0
              ? `Held longest — reprice or move these first`
              : 'Every change to stock is logged'}
            action={ageing.length > 0
              ? <Link href="/reports/ageing" className="text-small font-bold text-content-accent hover:underline">View all</Link>
              : can(user.role, 'audit:read')
                ? <Link href="/settings/audit" className="text-small font-bold text-content-accent hover:underline">Audit trail</Link>
                : undefined}
          />
          {ageing.length > 0 ? (
            <ul className="divide-y divide-line-subtle">
              {ageing.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-4 px-6 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-small font-bold text-content-primary">
                      {item.brandName} {item.model}
                    </p>
                    <p className="text-caption text-content-secondary">
                      Stock {item.stockNo} · {item.locationName}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-small font-bold tabular-nums text-content-primary">
                      {money(item.purchasePriceGbp)}
                    </p>
                    <p className="flex items-center justify-end gap-1 text-caption text-content-secondary">
                      <Clock className="h-3 w-3" aria-hidden />
                      {daysHeld(item.purchaseDate)} days
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <ActivityList activity={activity} />
          )}
        </Card>
      </section>

      {ageing.length > 0 && (
        <section className="mt-8">
          <Card>
            <CardHeader
              title="Recent activity"
              description="Every change to stock is logged"
              action={can(user.role, 'audit:read')
                ? <Link href="/settings/audit" className="text-small font-bold text-content-accent hover:underline">Full audit trail</Link>
                : undefined}
            />
            <ActivityList activity={activity} />
          </Card>
        </section>
      )}
    </>
  )
}

function ActivityList({ activity }: { activity: Awaited<ReturnType<typeof auditTrail>> }) {
  if (activity.entries.length === 0) {
    return (
      <EmptyState
        icon={<Camera className="h-6 w-6" />}
        title="No activity yet"
        description="Changes to stock, prices and sales are recorded here as they happen."
      />
    )
  }
  // Rows stack below sm: squeezing three columns onto a phone truncated the
  // summary to a single character, which told nobody anything.
  return (
    <ul className="divide-y divide-line-subtle">
      {activity.entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-1 px-6 py-3 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 items-center gap-3 sm:flex-1">
            <Chip tone="neutral">{AUDIT_ACTION_LABELS[entry.action as AuditAction]}</Chip>
            <p className="min-w-0 flex-1 truncate text-small text-content-primary">
              {entry.summary ?? `${entry.entityType} ${entry.entityId}`}
            </p>
          </div>
          <p className="shrink-0 text-caption text-content-secondary sm:ml-auto">
            {entry.actor?.name ?? 'System'} · <RelativeTime value={entry.createdAt} />
          </p>
        </li>
      ))}
    </ul>
  )
}

function greetingFor(date: Date): string {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** A one-line read on the business, so the header says something rather than nothing. */
function describePosition(inStock: number, locations: number, sold: number, days: number): string {
  if (inStock === 0) return 'No stock on hand yet — book your first watch in to get started.'
  const stockPart = `${inStock} ${inStock === 1 ? 'watch' : 'watches'} across ${locations} ${locations === 1 ? 'location' : 'locations'}`
  const salesPart = sold > 0
    ? `${sold} sold in the last ${days} days`
    : `nothing sold in the last ${days} days`
  return `${stockPart}, ${salesPart}. The jobs that need you are first.`
}

