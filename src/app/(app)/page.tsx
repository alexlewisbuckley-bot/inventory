import type { Metadata } from 'next'
import Link from 'next/link'
import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { AlertTriangle, ArrowRight, Clock, Package, PoundSterling, TrendingUp } from 'lucide-react'
import { requireUser } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { brands, sales, watches } from '@/server/db/schema'
import { countUnpriced, findAgeingStock, stockByLocation, summariseInventory } from '@/server/repositories/watch-repository'
import { auditTrail } from '@/server/services/audit'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardHeader, CardBody, StatCard, EmptyState, LinkButton, Chip } from '@/components/ui'
import { formatMoney, formatSigned, formatPct } from '@/lib/money'
import { formatDate, relativeTime, daysHeld } from '@/lib/dates'
import { LOCATION_TYPE_LABELS, AUDIT_ACTION_LABELS, type LocationType, type AuditAction } from '@/lib/enums'
import { watchQuerySchema } from '@/lib/validation'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

const AGEING_DAYS = 90

export default async function DashboardPage() {
  const user = await requireUser()

  // Active stock only — sold and written-off watches are excluded from the
  // capital and margin figures so the tiles answer "what do we hold now?".
  const activeQuery = watchQuerySchema.parse({ status: ['IN_STOCK', 'RESERVED', 'SALE_AGREED'] })

  const [summary, byLocation, ageing, unpriced, soldStats, recentSales, activity] = await Promise.all([
    summariseInventory(activeQuery),
    stockByLocation(),
    findAgeingStock(AGEING_DAYS, 5),
    countUnpriced(),
    db.select({
      count: count(),
      revenue: sql<number>`coalesce(sum(${sales.saleAmountUsd}), 0)`,
      profit: sql<number>`coalesce(sum(${sales.profitUsd}), 0)`,
    }).from(sales).where(and(isNull(sales.deletedAt), gte(sales.saleDate, new Date(Date.now() - 90 * 86_400_000)))),
    db.select({
      id: sales.id, invoiceNo: sales.invoiceNo, saleDate: sales.saleDate,
      amountUsd: sales.saleAmountUsd, profitUsd: sales.profitUsd, marginBps: sales.marginBps,
      model: watches.model, stockNo: watches.stockNo, brandName: brands.name,
    })
      .from(sales)
      .innerJoin(watches, eq(watches.id, sales.watchId))
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(isNull(sales.deletedAt))
      .orderBy(desc(sales.saleDate))
      .limit(5),
    auditTrail({ perPage: 8 }),
  ])

  const sold = soldStats[0]
  const marginOnPriced = summary.totalCostUsd > 0
    ? (summary.estProfitUsd / summary.totalCostUsd) * 100
    : null
  const greeting = greetingFor(new Date())

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user.name.split(' ')[0]}`}
        description="Live position across every location, with the jobs that need attention first."
        actions={can(user.role, 'watch:create')
          ? <LinkButton href="/inventory/new" icon={<span aria-hidden>+</span>}>Add watch</LinkButton>
          : undefined}
      />

      <section aria-label="Key figures" className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="In stock"
          value={summary.inStockCount}
          caption={`across ${byLocation.filter((l) => l.count > 0).length} locations`}
          icon={<Package className="h-4 w-4" />}
        />
        <StatCard
          label="Capital invested"
          value={formatMoney(summary.totalCostGbp, 'GBP')}
          caption={`avg ${formatMoney(summary.avgCostGbp, 'GBP')} per watch`}
          icon={<PoundSterling className="h-4 w-4" />}
        />
        <StatCard
          label="Est. sale value"
          value={formatMoney(summary.estSaleUsd, 'USD')}
          caption={`${summary.pricedCount} of ${summary.inStockCount} watches priced`}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Est. profit"
          value={formatSigned(summary.estProfitUsd, 'USD')}
          caption={marginOnPriced !== null ? `${formatPct(marginOnPriced)} margin on priced stock` : 'No priced stock yet'}
          tone="accent"
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </section>

      {(unpriced > 0 || ageing.length > 0) && (
        <section aria-label="Needs attention" className="mt-8 grid gap-6 lg:grid-cols-2">
          {unpriced > 0 && (
            <Card className="border-state-gold/40">
              <CardBody className="flex items-start gap-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-state-gold/15 text-state-gold" aria-hidden>
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-body font-bold text-content-primary">
                    {unpriced} {unpriced === 1 ? 'watch has' : 'watches have'} no sale price
                  </h2>
                  <p className="mt-1 text-small text-content-secondary">
                    Unpriced stock is invisible to margin forecasting. Setting a target price takes a moment.
                  </p>
                  <Link href="/inventory?unpricedOnly=true" className="mt-3 inline-flex items-center gap-1 text-small font-bold text-content-accent hover:underline">
                    Review unpriced stock <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </div>
              </CardBody>
            </Card>
          )}

          {ageing.length > 0 && (
            <Card>
              <CardHeader
                title="Ageing stock"
                description={`Held longer than ${AGEING_DAYS} days`}
                action={<Link href="/reports/ageing" className="text-small font-bold text-content-accent hover:underline">View all</Link>}
              />
              <ul className="divide-y divide-line-subtle">
                {ageing.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-4 px-6 py-3">
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
                        {formatMoney(item.purchasePriceGbp, 'GBP')}
                      </p>
                      <p className="flex items-center justify-end gap-1 text-caption text-content-secondary">
                        <Clock className="h-3 w-3" aria-hidden />
                        {daysHeld(item.purchaseDate)} days
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}

      <section className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Stock by location" description="Active stock and capital held" />
          <ul className="divide-y divide-line-subtle">
            {byLocation.map((row) => {
              const share = summary.inStockCount > 0 ? (Number(row.count) / summary.inStockCount) * 100 : 0
              return (
                <li key={row.locationId} className="px-6 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-body font-bold text-content-primary">{row.locationName}</p>
                      <p className="text-caption text-content-secondary">
                        {LOCATION_TYPE_LABELS[row.type as LocationType]}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-body font-bold tabular-nums text-content-primary">{Number(row.count)}</p>
                      <p className="text-caption tabular-nums text-content-secondary">
                        {formatMoney(Number(row.valueGbp), 'GBP')}
                      </p>
                    </div>
                  </div>
                  {/* Proportion bar — a sparkline would over-represent four rows. */}
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-pill bg-surface-subtle" role="presentation">
                    <div className="h-full rounded-pill bg-teal-500" style={{ width: `${Math.max(share, share > 0 ? 4 : 0)}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent sales"
            description={sold && Number(sold.count) > 0
              ? `${Number(sold.count)} sold in the last 90 days · ${formatSigned(Number(sold.profit), 'USD')} profit`
              : 'Nothing sold yet'}
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
                <li key={sale.id} className="flex items-center justify-between gap-4 px-6 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-body font-bold text-content-primary">
                      {sale.brandName} {sale.model}
                    </p>
                    <p className="text-caption text-content-secondary">
                      Stock {sale.stockNo} · {sale.invoiceNo} · {formatDate(sale.saleDate)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <span className="text-body font-bold tabular-nums text-content-primary">
                      {formatMoney(sale.amountUsd, 'USD')}
                    </span>
                    <Chip tone={sale.profitUsd >= 0 ? 'accent' : 'danger'}>
                      {formatSigned(sale.profitUsd, 'USD')} · {formatPct(sale.marginBps / 100)}
                    </Chip>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="mt-8">
        <Card>
          <CardHeader
            title="Recent activity"
            description="Every change to stock is logged"
            action={can(user.role, 'audit:read')
              ? <Link href="/settings/audit" className="text-small font-bold text-content-accent hover:underline">Full audit trail</Link>
              : undefined}
          />
          <ul className="divide-y divide-line-subtle">
            {activity.entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-4 px-6 py-3.5">
                <Chip tone="neutral">{AUDIT_ACTION_LABELS[entry.action as AuditAction]}</Chip>
                <p className="min-w-0 flex-1 truncate text-small text-content-primary">
                  {entry.summary ?? `${entry.entityType} ${entry.entityId}`}
                </p>
                <p className="shrink-0 text-caption text-content-secondary">
                  {entry.actor?.name ?? 'System'} · {relativeTime(entry.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </>
  )
}

function greetingFor(date: Date): string {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
