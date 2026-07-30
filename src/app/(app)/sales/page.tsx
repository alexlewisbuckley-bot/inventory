import type { Metadata } from 'next'
import { Download, Receipt, SearchX } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { findSales, summariseSales, type SaleQuery } from '@/server/repositories/sale-repository'
import { PageHeader } from '@/components/layout/PageHeader'
import { SalesTable } from '@/components/sales/SalesTable'
import { SalesFilterBar } from '@/components/sales/SalesFilterBar'
import { FilterBar } from '@/components/ui/DataList'
import { parseFilters, SALE_FIELDS, toSearchParams } from '@/lib/filters'
import { Card, StatCard, LinkButton, EmptyState } from '@/components/ui'
import { formatPct } from '@/lib/money'
import { formatBase, formatBaseSigned, isCurrency } from '@/lib/currency'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { BASE_CURRENCY, SALE_CHANNELS, type SaleChannel } from '@/lib/enums'
import { can, canSeeCost } from '@/lib/permissions'
import { redactRows } from '@/server/redact'

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
    f: parseFilters(toSearchParams(searchParams), SALE_FIELDS),
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

  // The cost side leaves the server only for roles that may see it. Nulled
  // here rather than hidden in the table — hidden is still in the payload.
  const showCost = canSeeCost(user.role)
  const items = redactRows(user.role as never, result.items, {
    cost: ['costGbp', 'profitGbp', 'marginBps', 'vsEstimateGbp'],
  })
  // "Nothing here yet" and "nothing matches your filters" are different
  // situations and want different screens.
  // The V2 clauses count as filtering too. Without them, a URL carrying only
  // `f=` clauses that match nothing would show "no sales recorded yet" — which
  // tells the reader the business has never sold anything, rather than that
  // their filter is too narrow.
  const filtered = Boolean(
    query.q || query.channel?.length || query.from || query.to || query.f?.length,
  )
  const isFirstRun = result.total === 0 && !filtered

  return (
    <>
      <PageHeader
        title="Sales"
        description={summary.count > 0
          ? `${summary.count} ${summary.count === 1 ? 'sale' : 'sales'} in this view · ${money(summary.revenueGbp)} revenue`
          : 'Every watch you have sold, with the margin you actually realised.'}
        actions={exportable && !isFirstRun
          ? <LinkButton href="/api/export/sales" variant="secondary" icon={<Download className="h-4 w-4" />}>Export CSV</LinkButton>
          : undefined}
      />

      {/* A first-run page shows nothing but the way in. Four £0 tiles and a
          filter toolbar over an empty table is furniture for data that does
          not exist yet, and it makes the one thing to do harder to find. */}
      {isFirstRun ? (
        <Card>
          <EmptyState
            icon={<Receipt className="h-6 w-6" />}
            title="No sales recorded yet"
            description="Open a watch in the inventory and choose “Mark as sold”. Profit and margin are worked out for you."
            action={<LinkButton href="/inventory">Go to the inventory</LinkButton>}
          />
        </Card>
      ) : (
        <>
      <section aria-label="Sales summary" className="mb-8 grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-4">
        <StatCard label="Sales" value={summary.count} caption="in the current view" />
        <StatCard label="Revenue" value={money(summary.revenueGbp)} caption="gross, excluding fees" />
        {showCost && (
          <StatCard label="Realised profit" value={formatBaseSigned(summary.profitGbp, currency, rates)} tone="accent" caption="sale price minus purchase cost" />
        )}
        {showCost && (
        <StatCard
          label="Weighted margin"
          value={formatPct(summary.avgMarginBps / 100)}
          caption={summary.bestMarginBps !== null
            ? `best ${formatPct(summary.bestMarginBps / 100)} · worst ${formatPct(summary.worstMarginBps! / 100)}`
            : undefined}
          tone="accent"
        />
        )}
      </section>

      {/* The date range keeps its own control — a from/to pair is the one
          filter a chip cannot express as well as two date inputs, and the
          ledger is read by date more than by anything else. */}
      <SalesFilterBar />

      <FilterBar
        fields={SALE_FIELDS}
        placeholder="Search by invoice number, buyer, model or stock number…"
      />

      <Card className="overflow-hidden">
        {result.total === 0 ? (
          <EmptyState
            icon={<SearchX className="h-6 w-6" />}
            title="No sales match these filters"
            description="Try a wider date range, or clear the filters to see everything."
            action={<LinkButton href="/sales" variant="secondary">Clear filters</LinkButton>}
          />
        ) : (
          <SalesTable result={{ ...result, items }} showCost={showCost} />
        )}
      </Card>
        </>
      )}
    </>
  )
}
