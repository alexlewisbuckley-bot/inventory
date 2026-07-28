import type { Metadata } from 'next'
import { Download, Receipt } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { findSales, summariseSales, type SaleQuery } from '@/server/repositories/sale-repository'
import { PageHeader } from '@/components/layout/PageHeader'
import { SalesTable } from '@/components/sales/SalesTable'
import { SalesFilterBar } from '@/components/sales/SalesFilterBar'
import { Card, StatCard, LinkButton, EmptyState } from '@/components/ui'
import { formatPct } from '@/lib/money'
import { formatBase, formatBaseSigned, isCurrency } from '@/lib/currency'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { BASE_CURRENCY, SALE_CHANNELS, type SaleChannel } from '@/lib/enums'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Sales' }
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

function parseQuery(searchParams: SearchParams): SaleQuery {
  const channels = searchParams.channel
    ? (Array.isArray(searchParams.channel) ? searchParams.channel : [searchParams.channel])
        .filter((c): c is SaleChannel => SALE_CHANNELS.includes(c as SaleChannel))
    : undefined
  return {
    q: typeof searchParams.q === 'string' ? searchParams.q : undefined,
    channel: channels,
    from: searchParams.from ? new Date(String(searchParams.from)) : undefined,
    to: searchParams.to ? new Date(String(searchParams.to)) : undefined,
    sort: (searchParams.sort as SaleQuery['sort']) ?? 'saleDate',
    dir: (searchParams.dir as 'asc' | 'desc') ?? 'desc',
    page: Number(searchParams.page ?? 1),
    perPage: Number(searchParams.perPage ?? 25),
  }
}

export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireCapability('sale:read')
  const query = parseQuery(searchParams)
  const [result, summary, rates, preferences] = await Promise.all([
    findSales(query),
    summariseSales(query),
    getRateTable(),
    getPreferencesFor(user.id),
  ])

  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : BASE_CURRENCY
  const money = (base: number | null) => formatBase(base, currency, rates)

  const exportable = can(user.role, 'report:export')

  return (
    <>
      <PageHeader
        title="Sales"
        description={summary.count > 0
          ? `${summary.count} ${summary.count === 1 ? 'sale' : 'sales'} in this view · ${money(summary.revenueGbp)} revenue`
          : 'Every watch you have sold, with the margin you actually realised.'}
        actions={exportable
          ? <LinkButton href="/api/export/sales" variant="secondary" icon={<Download className="h-4 w-4" />}>Export CSV</LinkButton>
          : undefined}
      />

      <section aria-label="Sales summary" className="mb-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sales" value={summary.count} caption="in the current view" />
        <StatCard label="Revenue" value={money(summary.revenueGbp)} caption="gross, excluding fees" />
        <StatCard label="Realised profit" value={formatBaseSigned(summary.profitGbp, currency, rates)} tone="accent" caption="sale price minus purchase cost" />
        <StatCard
          label="Weighted margin"
          value={formatPct(summary.avgMarginBps / 100)}
          caption={summary.bestMarginBps !== null
            ? `best ${formatPct(summary.bestMarginBps / 100)} · worst ${formatPct(summary.worstMarginBps! / 100)}`
            : undefined}
          tone="accent"
        />
      </section>

      <SalesFilterBar />

      <Card className="overflow-hidden">
        {result.total === 0 ? (
          <EmptyState
            icon={<Receipt className="h-6 w-6" />}
            title="No sales recorded yet"
            description="Open a watch from the inventory and choose “Record sale”. Profit and margin are calculated for you."
            action={<LinkButton href="/inventory">Go to inventory</LinkButton>}
          />
        ) : (
          <SalesTable result={result} />
        )}
      </Card>
    </>
  )
}
