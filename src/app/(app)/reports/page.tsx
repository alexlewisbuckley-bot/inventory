import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Clock, Store, TrendingUp } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { salesByMonth, summariseSales, supplierPerformance } from '@/server/repositories/sale-repository'
import { stockByLocation, summariseInventory, findAgeingStock } from '@/server/repositories/watch-repository'
import { watchQuerySchema } from '@/lib/validation'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardHeader, StatCard, EmptyState } from '@/components/ui'
import { MonthlyChart } from '@/components/reports/MonthlyChart'
import { formatPct } from '@/lib/money'
import { formatBase, formatBaseSigned, isCurrency } from '@/lib/currency'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { BASE_CURRENCY, locationTypeCaption, type LocationType } from '@/lib/enums'

export const metadata: Metadata = { title: 'Reports' }
export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const user = await requireCapability('report:read')

  const activeQuery = watchQuerySchema.parse({ status: ['IN_STOCK', 'RESERVED', 'SALE_AGREED'] })
  const [inventory, sales, monthly, suppliers, byLocation, ageing, rates, preferences] = await Promise.all([
    summariseInventory(activeQuery),
    summariseSales({}),
    salesByMonth(12),
    supplierPerformance(),
    stockByLocation(),
    findAgeingStock(90, 100),
    getRateTable(),
    getPreferencesFor(user.id),
  ])

  // Every figure below is stored in GBP and rendered in the viewer's chosen
  // currency, so the page can never mix symbols the way it used to.
  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : BASE_CURRENCY
  const money = (base: number | null) => formatBase(base, currency, rates)
  const signed = (base: number | null) => formatBaseSigned(base, currency, rates)

  const turnover = inventory.totalCostGbp > 0 && sales.count > 0
    ? sales.count / (inventory.inStockCount + sales.count)
    : 0

  return (
    <>
      <PageHeader
        title="Reports"
        description="How capital is deployed, what it is returning, and where it is sitting still."
      />

      <section aria-label="Headline figures" className="mb-8 grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-4">
        <StatCard label="Capital deployed" value={money(inventory.totalCostGbp)} caption={`${inventory.inStockCount} watches held`} />
        <StatCard label="Lifetime revenue" value={money(sales.revenueGbp)} caption={`${sales.count} sales`} />
        <StatCard label="Lifetime profit" value={signed(sales.profitGbp)} tone="accent" caption={`${formatPct(sales.avgMarginBps / 100)} weighted margin`} />
        <StatCard label="Sell-through" value={formatPct(turnover * 100, 0)} caption="of all stock ever acquired" />
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Revenue and profit by month" description="Last 12 months" />
          {monthly.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="h-6 w-6" />}
              title="Not enough sales history yet"
              description="Once you have recorded sales, monthly revenue and profit will chart here."
            />
          ) : (
            <MonthlyChart
              data={monthly.map((m) => ({
                month: m.month,
                revenue: Number(m.revenue),
                profit: Number(m.profit),
                count: Number(m.count),
              }))}
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Capital by location" />
          <ul className="divide-y divide-line-subtle">
            {byLocation.map((row) => (
              <li key={row.locationId} className="flex items-center justify-between gap-3 px-6 py-4">
                <div className="min-w-0">
                  <p className="truncate text-body font-bold text-content-primary">{row.locationName}</p>
                  {locationTypeCaption(row.locationName, row.type as LocationType) && (
                    <p className="text-caption text-content-secondary">{locationTypeCaption(row.locationName, row.type as LocationType)}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-body font-bold tabular-nums text-content-primary">{money(Number(row.valueGbp))}</p>
                  <p className="text-caption tabular-nums text-content-secondary">{Number(row.count)} watches</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Supplier performance" description="Spend against realised profit" />
          <ul className="divide-y divide-line-subtle">
            {suppliers.slice(0, 6).map((supplier) => (
              <li key={supplier.supplierId} className="px-6 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-body font-bold text-content-primary">{supplier.supplierName}</p>
                    <p className="text-caption text-content-secondary">
                      {Number(supplier.watchCount)} bought · {Number(supplier.soldCount)} sold
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-body font-bold tabular-nums text-content-primary">
                      {money(Number(supplier.totalCostGbp))}
                    </p>
                    <p className={
                      Number(supplier.realisedProfitGbp) >= 0
                        ? 'text-caption tabular-nums text-content-accent'
                        : 'text-caption tabular-nums text-state-danger'
                    }>
                      {signed(Number(supplier.realisedProfitGbp))} realised
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-line-subtle px-6 py-3.5">
            <Link href="/suppliers" className="inline-flex items-center gap-1 text-small font-bold text-content-accent hover:underline">
              Manage suppliers <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Ageing stock"
            description="Held more than 90 days"
            action={
              <Link href="/reports/ageing" className="inline-flex items-center gap-1 text-small font-bold text-content-accent hover:underline">
                Full report <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            }
          />
          {ageing.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-6 w-6" />}
              title="Nothing is ageing"
              description="Every watch in stock was bought within the last 90 days."
            />
          ) : (
            <div className="px-6 py-5">
              <p className="text-h2 font-extrabold text-content-primary">{ageing.length}</p>
              <p className="mt-1 text-small text-content-secondary">
                watches, {money(ageing.reduce((sum, a) => sum + a.purchasePriceGbp, 0))} of capital
                sitting longer than 90 days.
              </p>
              <ul className="mt-4 flex flex-col gap-2">
                {ageing.slice(0, 5).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 text-small">
                    <span className="truncate text-content-primary">{item.brandName} {item.model}</span>
                    <span className="shrink-0 text-content-secondary">{item.locationName}</span>
                  </li>
                ))}
              </ul>
              {ageing.length > 5 && (
                <p className="mt-3 text-caption text-content-secondary">
                  and {ageing.length - 5} more.{' '}
                  <Link href="/reports/ageing" className="font-bold text-content-accent hover:underline">
                    See the full report
                  </Link>
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Other reports" />
        <ul className="grid gap-4 px-6 py-5 sm:grid-cols-2">
          <ReportLink href="/reports/ageing" icon={<Clock className="h-4 w-4" />} title="Ageing stock"
            description="Everything held longer than the warning threshold, oldest first." />
          <ReportLink href="/inventory?unpricedOnly=true" icon={<Store className="h-4 w-4" />} title="Unpriced stock"
            description="Watches with no estimated sale price, invisible to margin forecasting." />
        </ul>
      </Card>
    </>
  )
}

function ReportLink({ href, icon, title, description }: {
  href: string; icon: React.ReactNode; title: string; description: string
}) {
  return (
    <li>
      <Link href={href} className="flex gap-3 rounded-md border border-line-subtle p-4 transition-colors hover:border-line-strong">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-subtle text-content-secondary" aria-hidden>
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-body font-bold text-content-primary">{title}</span>
          <span className="block text-caption text-content-secondary">{description}</span>
        </span>
      </Link>
    </li>
  )
}
