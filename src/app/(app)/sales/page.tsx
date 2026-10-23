import type { Metadata } from 'next'
import { Download, Receipt, SearchX } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { summariseSales, type SaleQuery } from '@/server/repositories/sale-repository'
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
import { BASE_CURRENCY, DEFAULT_DISPLAY_CURRENCY, SALE_CHANNELS, type SaleChannel } from '@/lib/enums'
import { can, canSeeCost } from '@/lib/permissions'
import { redactRows } from '@/server/redact'
import { listSalesPeople } from '@/server/services/reference-service'
import { brokerageTotals, sellableStock } from '@/server/services/brokerage-service'
import { findSalesLedger } from '@/server/services/sales-ledger'
import { RecordCommission } from '@/components/sales/RecordCommission'

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
  /*
   * Commission is shown for the same window the sales table is filtered to,
   * so the two add up to what the period actually earned. With no dates
   * chosen that is everything, which matches the table above it.
   */
  const brokerFrom = query.from ? new Date(query.from) : undefined
  const brokerTo = query.to ? new Date(query.to) : undefined

  const [result, summary, rates, preferences, salesPeople, brokerTotals, stock] = await Promise.all([
    // One ledger: watches we sold, and fees we earned selling other
    // people's. Kept in the same list because that is how a month's
    // earnings are read.
    findSalesLedger(query),
    summariseSales(query),
    getRateTable(),
    getPreferencesFor(user.id),
    listSalesPeople(),
    brokerageTotals(brokerFrom, brokerTo),
    // Stock still on the book, for a fee earned on one of ours. Only what
    // we still hold: a watch already gone cannot be sold again.
    can(user.role, 'sale:create') ? sellableStock() : Promise.resolve([]),
  ])

  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : DEFAULT_DISPLAY_CURRENCY
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
        /*
         * One count and one revenue, both including brokerage. A brokered
         * deal is a sale, so a header that counted it apart from the rows
         * it sits beside would be describing a different table.
         */
        description={summary.count + brokerTotals.count > 0
          ? `${summary.count + brokerTotals.count} ${summary.count + brokerTotals.count === 1 ? 'sale' : 'sales'} in this view`
            + ` · ${money(summary.revenueGbp + brokerTotals.total)} revenue`
          : 'Every watch you have sold, with the margin you actually realised.'}
        actions={
          <>
            {/* Always offered, including on a first run: a business that has
                not sold its own stock yet may still have brokered a deal,
                and that is exactly when it needs somewhere to put it. */}
            {can(user.role, 'sale:create') && (
              <RecordCommission people={salesPeople} stock={stock} />
            )}
            {exportable && !isFirstRun && (
              <LinkButton href="/api/export/sales" variant="secondary" icon={<Download className="h-4 w-4" />}>Export</LinkButton>
            )}
          </>
        }
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
        {/* A brokered deal is a sale and the fee is profit, so all three
            of these count it. Margin is the exception below, and for a
            reason rather than an omission. */}
        <StatCard
          label="Sales"
          value={summary.count + brokerTotals.count}
          caption={brokerTotals.count > 0
            ? `${summary.count} from stock · ${brokerTotals.count} brokered`
            : 'in the current view'}
        />
        <StatCard
          label="Revenue"
          value={money(summary.revenueGbp + brokerTotals.total)}
          caption={brokerTotals.count > 0
            ? `including ${money(brokerTotals.total)} commission`
            : 'gross, excluding fees'}
        />
        {showCost && (
          <StatCard
            label="Realised profit"
            value={formatBaseSigned(summary.profitGbp + brokerTotals.total, currency, rates)}
            tone="accent"
            caption={brokerTotals.count > 0
              ? `including ${money(brokerTotals.total)} commission, which has no cost`
              : 'sale price minus purchase cost'}
          />
        )}
        {showCost && (
        <StatCard
          label="Weighted margin"
          value={formatPct(summary.avgMarginBps / 100)}
          /*
           * The one figure that stays stock-only, and says so.
           *
           * Margin is profit over cost. A brokered fee has no cost under
           * it, so it has no margin — not a hundred per cent, undefined —
           * and folding it in would not enrich this number, it would
           * replace it with one that cannot be compared to last month's.
           */
          caption={[
            brokerTotals.count > 0 ? 'on stock sold' : null,
            summary.bestMarginBps !== null
              ? `best ${formatPct(summary.bestMarginBps / 100)} · worst ${formatPct(summary.worstMarginBps! / 100)}`
              : null,
          ].filter(Boolean).join(' · ') || undefined}
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
          <SalesTable
            result={{ ...result, items }}
            showCost={showCost}
            canVoid={can(user.role, 'sale:delete')}
            canAmend={can(user.role, 'sale:update')}
            canAmendCost={can(user.role, 'watch:amend')}
            salesPeople={salesPeople}
            stock={stock}
          />
        )}
      </Card>
        </>
      )}
    </>
  )
}
