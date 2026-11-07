import type { Metadata } from 'next'
import { Download, Receipt, SearchX } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { summariseSales, type SaleQuery } from '@/server/repositories/sale-repository'
import { PageHeader } from '@/components/layout/PageHeader'
import { SalesTable } from '@/components/sales/SalesTable'
import { SalesFilterBar } from '@/components/sales/SalesFilterBar'
import { SALES_VIEWS } from '@/components/sales/views'
import { FilterBar, ViewBar } from '@/components/ui/DataList'
import { listViews } from '@/server/services/views-service'
import { parseFilters, SALE_FIELDS, toSearchParams } from '@/lib/filters'
import { Card, StatCard, LinkButton, EmptyState } from '@/components/ui'
import { formatPct } from '@/lib/money'
import { formatBase, formatBaseSigned, isCurrency } from '@/lib/currency'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { BASE_CURRENCY, DEFAULT_DISPLAY_CURRENCY, SALE_CHANNELS, type SaleChannel } from '@/lib/enums'
import { can, canSeeCost } from '@/lib/permissions'
import { lastImportWindow } from '@/server/services/xero-service'
import { redactRows } from '@/server/redact'
import { listSalesPeople } from '@/server/services/reference-service'
import { brokerageTotals, sellableStock } from '@/server/services/brokerage-service'
import { buybackTotals } from '@/server/services/buyback-service'
import { feeArms, findSalesLedger, soldByClause } from '@/server/services/sales-ledger'
import { RecordCommission } from '@/components/sales/RecordCommission'

export const metadata: Metadata = { title: 'Sales' }
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

/** A plain day from the date box, taken to its last instant. */
function endOfDay(value: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return parsed
  // Only for a bare day. A full timestamp was asked for exactly.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return parsed
  return new Date(parsed.getTime() + 86_399_999)
}

function parseQuery(searchParams: SearchParams): SaleQuery {
  const channels = searchParams.channel
    ? (Array.isArray(searchParams.channel) ? searchParams.channel : [searchParams.channel])
        .filter((c): c is SaleChannel => SALE_CHANNELS.includes(c as SaleChannel))
    : undefined
  return {
    q: typeof searchParams.q === 'string' ? searchParams.q : undefined,
    channel: channels,
    from: searchParams.from ? new Date(String(searchParams.from)) : undefined,
    /*
     * To the end of that day, not its midnight.
     *
     * "2026-11-30" parsed plainly is 00:00 on the 30th, so a range ending
     * there excluded almost all of its last day. A sale date is stored at
     * midnight and survived it; a commission or a buy-back charge carries a
     * time and did not, so the last day of any range quietly lost its fees.
     */
    to: searchParams.to ? endOfDay(String(searchParams.to)) : undefined,
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

  /*
   * The cards answer for the same rows the table does.
   *
   * These two totals only ever took dates, so they counted every fee in the
   * period whatever else was filtered. That was invisible while no filter
   * could separate the kinds; now that the bar has a chip for each, the
   * Commission view headlined "2 brokered · 1 buy-back" over a list of two
   * commissions, and the revenue card added a buy-back the list did not
   * contain. A total that disagrees with the rows under it is worse than no
   * total: it is the number somebody writes down.
   */
  const arms = feeArms(query)
  const noFees = { paid: 0, pending: 0, total: 0, count: 0 }
  /*
   * And narrowed to the same person the table is.
   *
   * The arms decide *whether* a fee ledger is counted; this decides whose.
   * Without it, filtering to one salesperson left the cards counting
   * everybody's fees over the period while the rows below showed one
   * person's — a headline of 5 over a table of 4, which is the kind of
   * disagreement somebody writes down.
   */
  const person = soldByClause(query)

  const [result, summary, rates, preferences, salesPeople, brokerTotals, interest, stock, lastImport, savedViews] = await Promise.all([
    // One ledger: watches we sold, and fees we earned selling other
    // people's. Kept in the same list because that is how a month's
    // earnings are read.
    findSalesLedger(query),
    summariseSales(query),
    getRateTable(),
    getPreferencesFor(user.id),
    listSalesPeople(),
    arms.commissions ? brokerageTotals(brokerFrom, brokerTo, person) : Promise.resolve(noFees),
    // Interest and extension fees on money lent. Earnings with no cost
    // under them, like a brokered fee, and in the same list for the same
    // reason: one place to read what the month made.
    arms.charges ? buybackTotals(brokerFrom, brokerTo, person) : Promise.resolve(noFees),
    // Stock still on the book, for a fee earned on one of ours. Only what
    // we still hold: a watch already gone cannot be sold again.
    can(user.role, 'sale:create') ? sellableStock() : Promise.resolve([]),
    // The last Xero import, so a sale inside the period it covered that
    // the accounts never saw can say so on its own row.
    lastImportWindow(),
    // Views somebody made over this ledger, their own and anything a
    // colleague shared.
    listViews('sale', user.id),
  ])

  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : DEFAULT_DISPLAY_CURRENCY
  const money = (base: number | null) => formatBase(base, currency, rates)

  /** Earnings with no stock under them: brokered fees and buy-back charges. */
  const earned = brokerTotals.total + interest.total

  /** Every row the table will show, counted once for both headlines. */
  const ledgerCount = summary.count + brokerTotals.count + interest.count

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
        /*
         * All three income sources, as the Sales card beside it counts.
         *
         * This added stock sales and brokered fees and stopped — the
         * buy-back charges were simply missing, so the header said 3 over a
         * card saying 5 over a table of 4. The file's own warning, written
         * a few lines down about a different loop: the second place is
         * where the third income source gets forgotten.
         */
        description={ledgerCount > 0
          ? `${ledgerCount} ${ledgerCount === 1 ? 'sale' : 'sales'} in this view`
            + ` · ${money(summary.revenueGbp + brokerTotals.total + interest.total)} revenue`
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
          value={ledgerCount}
          caption={[
            `${summary.count} from stock`,
            brokerTotals.count > 0 ? `${brokerTotals.count} brokered` : null,
            interest.count > 0 ? `${interest.count} buy-back` : null,
          ].filter(Boolean).join(' · ') || 'in the current view'}
        />
        <StatCard
          label="Revenue"
          value={money(summary.revenueGbp + brokerTotals.total + interest.total)}
          caption={earned > 0
            ? `including ${money(earned)} in fees and interest`
            : 'gross, excluding fees'}
        />
        {showCost && (
          <StatCard
            label="Realised profit"
            value={formatBaseSigned(summary.profitGbp + brokerTotals.total + interest.total, currency, rates)}
            tone="accent"
            caption={earned > 0
              ? `including ${money(earned)} in fees and interest, which have no cost`
              : 'sale price minus purchase cost'}
          />
        )}
        {showCost && (
        <StatCard
          label="Weighted margin"
          /*
           * A dash where there is no stock in the view to have a margin on.
           *
           * The average is zero when nothing was sold from stock, and zero
           * prints as "0.0%" — which reads as "we made nothing on these"
           * rather than "this does not apply". It was unreachable until the
           * bar put a Commission chip one click away; now it is the first
           * thing on screen. The same rule the table already follows for a
           * fee's own margin: undefined is a dash, not a number to average.
           */
          value={summary.count > 0 ? formatPct(summary.avgMarginBps / 100) : '—'}
          /*
           * The one figure that stays stock-only, and says so.
           *
           * Margin is profit over cost. A brokered fee has no cost under
           * it, so it has no margin — not a hundred per cent, undefined —
           * and folding it in would not enrich this number, it would
           * replace it with one that cannot be compared to last month's.
           */
          caption={[
            summary.count === 0 ? 'nothing sold from stock in this view' : null,
            summary.count > 0 && brokerTotals.count > 0 ? 'on stock sold' : null,
            summary.bestMarginBps !== null
              ? `best ${formatPct(summary.bestMarginBps / 100)} · worst ${formatPct(summary.worstMarginBps! / 100)}`
              : null,
          ].filter(Boolean).join(' · ') || undefined}
          tone="accent"
        />
        )}
      </section>

      {/* Above the date range and the filter bar, as on the stock list: a
          view is which list you are looking at, and the two bars below are
          how you narrow the one you chose. */}
      <ViewBar object="sale" builtIn={SALES_VIEWS} saved={savedViews} />

      {/* The date range keeps its own control — a from/to pair is the one
          filter a chip cannot express as well as two date inputs, and the
          ledger is read by date more than by anything else. */}
      <SalesFilterBar />

      <FilterBar
        fields={SALE_FIELDS}
        placeholder="Search by invoice number, buyer, model or stock number…"
        options={{
          // So "Sold by" offers the people rather than a box to type an id
          // into — and so a link from the sales-by-person report lands on a
          // chip that reads their name.
          salesPeople: salesPeople.map((person) => ({ value: person.id, label: person.name })),
        }}
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
            lastImport={lastImport}
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
