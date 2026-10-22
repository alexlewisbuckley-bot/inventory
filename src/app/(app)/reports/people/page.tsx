import type { Metadata } from 'next'
import Link from 'next/link'
import { Users } from 'lucide-react'
import { requireAnyCapability } from '@/server/auth/session'
import { salesByPersonWithBrokerage } from '@/server/services/brokerage-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { ReportTabs } from '@/components/reports/ReportTabs'
import { reportTabs } from '@/components/reports/tabs'
import { Card, StatCard, EmptyState, Table, THead, TBody, TR, TD, TH } from '@/components/ui'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { Bar, type BarDatum } from '@/components/charts/Bar'
import { formatBase, formatBaseSigned, isCurrency } from '@/lib/currency'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { listSalesPeople, salesPersonForUser } from '@/server/services/reference-service'
import { DEFAULT_DISPLAY_CURRENCY } from '@/lib/enums'
import { formatPct } from '@/lib/money'
import { salesScope } from '@/lib/permissions'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/cn'

export const metadata: Metadata = { title: 'Sales by person' }
export const dynamic = 'force-dynamic'

/**
 * The periods a dealer actually asks about.
 *
 * Deliberately not a date picker. The question is nearly always "how is this
 * month going" or "how did last month end", and a pair of date fields makes
 * somebody type two dates to ask it. The custom range lives on the sales
 * ledger, which is where an unusual question belongs.
 */
const PERIODS = {
  month: { label: 'This month', months: 0 },
  last: { label: 'Last month', months: 1 },
  quarter: { label: 'Last 3 months', months: 3 },
  year: { label: 'This year', months: 12 },
  all: { label: 'All time', months: null },
} as const

type PeriodKey = keyof typeof PERIODS

/**
 * The window, and the window before it of the same length.
 *
 * The comparison is the whole point of a dashboard — a figure with nothing
 * beside it says what happened but not whether it is good. The previous
 * window is the same shape so the two are honestly comparable, which rules
 * out comparing a part-finished month against a whole one without saying so.
 */
function windowFor(key: PeriodKey): {
  from: Date | undefined
  to: Date | undefined
  prevFrom: Date | undefined
  prevTo: Date | undefined
  partial: boolean
} {
  const now = new Date()
  if (key === 'all') {
    return { from: undefined, to: undefined, prevFrom: undefined, prevTo: undefined, partial: false }
  }
  if (key === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    const prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return { from, to: now, prevFrom, prevTo: new Date(now.getFullYear(), now.getMonth(), 0), partial: true }
  }
  if (key === 'last') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    const prevFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    return { from, to, prevFrom, prevTo: new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59), partial: false }
  }
  if (key === 'year') {
    const from = new Date(now.getFullYear(), 0, 1)
    return {
      from, to: now,
      prevFrom: new Date(now.getFullYear() - 1, 0, 1),
      prevTo: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
      partial: true,
    }
  }
  const from = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
  return {
    from, to: now,
    prevFrom: new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()),
    prevTo: from,
    partial: false,
  }
}

/** How a figure moved, as a sentence rather than a bare arrow. */
function movement(now: number, before: number): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (before === 0) return now === 0 ? { text: 'nothing either period', tone: 'flat' } : { text: 'none in the period before', tone: 'up' }
  const change = ((now - before) / Math.abs(before)) * 100
  if (Math.abs(change) < 0.5) return { text: 'level with the period before', tone: 'flat' }
  return {
    text: `${change > 0 ? '+' : ''}${change.toFixed(0)}% on the period before`,
    tone: change > 0 ? 'up' : 'down',
  }
}

/**
 * Sales by person.
 *
 * The reports page carries a six-line summary of this, which answers "who is
 * ahead" and nothing else. The questions that follow it — ahead by how much,
 * on what margin, against last month, and is anybody quietly not selling —
 * each needed a separate query somebody ran by hand, so mostly nobody ran
 * them.
 *
 * Ranked on profit rather than revenue. Revenue rewards whoever happens to be
 * handed the expensive watches; profit is the figure the business runs on,
 * and a dashboard that ranks on the wrong one quietly teaches people to
 * discount.
 */
export default async function SalesByPersonPage({ searchParams }: {
  searchParams: { period?: string }
}) {
  // Two legitimate doors: the whole book for a manager, your own month for
  // somebody who sells. Which one you came through decides what is queried,
  // not what is hidden afterwards.
  const user = await requireAnyCapability('report:read', 'report:own')
  const scope = salesScope(user.role)

  const key: PeriodKey = (searchParams.period && searchParams.period in PERIODS)
    ? searchParams.period as PeriodKey
    : 'month'
  const { from, to, prevFrom, prevTo, partial } = windowFor(key)

  const me = scope === 'own' ? await salesPersonForUser(user.id) : null
  // A scoped reader with no link to a salesperson is asked to be linked
  // rather than shown an empty leaderboard they would read as "no sales".
  const onlyMine = scope === 'own' ? me?.id ?? '__unlinked__' : undefined

  const [rows, previous, roster, rates, preferences] = await Promise.all([
    // Includes brokered deals: a commission is a sale the person made and
    // the fee is profit they earned, so a leaderboard that left it out
    // would rank them on part of their month.
    salesByPersonWithBrokerage(from, to, onlyMine),
    key === 'all' ? Promise.resolve([]) : salesByPersonWithBrokerage(prevFrom, prevTo, onlyMine),
    // The roster is who else exists, which is not a scoped reader's business.
    scope === 'all' ? listSalesPeople() : Promise.resolve([]),
    getRateTable(),
    getPreferencesFor(user.id),
  ])

  const currency = isCurrency(preferences?.displayCurrency)
    ? preferences.displayCurrency
    : DEFAULT_DISPLAY_CURRENCY
  const money = (base: number) => formatBase(base, currency, rates)
  const signed = (base: number) => formatBaseSigned(base, currency, rates)

  const before = new Map(previous.map((row) => [row.personId ?? 'none', row]))

  /**
   * A colour per person, fixed by their place on the roster rather than by
   * where they come on the chart. Colour follows the entity: narrowing the
   * period must not repaint everybody because the order changed.
   */
  const slotOf = new Map(roster.map((person, index) => [person.id, ((index % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6]))

  const people = rows.map((row) => {
    const cost = Number(row.costGbp)
    const prior = before.get(row.personId ?? 'none')
    return {
      id: row.personId,
      name: row.personName,
      sold: Number(row.soldCount),
      revenue: Number(row.revenueGbp),
      profit: Number(row.profitGbp),
      cost,
      /*
       * Margin is measured on stock only, as it is on the sales ledger.
       *
       * `profitGbp` now includes brokered fees, which have no cost under
       * them — dividing that by a cost that never moved would inflate
       * every percentage on this page. `stockProfitGbp` is the part a
       * margin can honestly be taken of.
       */
      margin: cost > 0 ? (Number(row.stockProfitGbp) / cost) * 100 : null,
      average: Number(row.soldCount) > 0 ? Number(row.revenueGbp) / Number(row.soldCount) : 0,
      lastSaleAt: row.lastSaleAt,
      priorProfit: prior ? Number(prior.profitGbp) : 0,
      slot: row.personId ? slotOf.get(row.personId) ?? 1 : undefined,
    }
  })

  const totals = people.reduce(
    (sum, person) => ({
      sold: sum.sold + person.sold,
      revenue: sum.revenue + person.revenue,
      profit: sum.profit + person.profit,
      cost: sum.cost + person.cost,
    }),
    { sold: 0, revenue: 0, profit: 0, cost: 0 },
  )
  const priorTotals = previous.reduce(
    (sum, row) => ({
      sold: sum.sold + Number(row.soldCount),
      revenue: sum.revenue + Number(row.revenueGbp),
      profit: sum.profit + Number(row.profitGbp),
    }),
    { sold: 0, revenue: 0, profit: 0 },
  )

  // Nobody is dropped for having sold nothing. A leaderboard that lists only
  // the people who sold tells you who is ahead and hides the thing a manager
  // most needs to see.
  const idle = scope === 'all'
    ? roster.filter((person) => !people.some((row) => row.id === person.id))
    : []

  const bars: BarDatum[] = people
    .filter((person) => person.profit !== 0 || person.sold > 0)
    .map((person) => ({
      label: person.name,
      value: Math.max(person.profit, 0),
      display: signed(person.profit),
      caption: `${person.sold} sold · ${money(person.revenue)} revenue${person.margin !== null ? ` · ${formatPct(person.margin)} margin` : ''}`,
      slot: person.slot,
      // The sales nobody is recorded against are not a seventh person, and a
      // slot colour would say they were.
      neutral: !person.id,
      href: person.id ? `/sales?q=${encodeURIComponent(person.name)}` : undefined,
    }))

  return (
    <>
      <PageHeader
        // No parent crumb for a scoped reader: /reports is behind
        // `report:read`, which they do not hold, so linking to it offers them
        // a door that answers with a refusal. This page is the whole of the
        // reports section as far as they are concerned.
        breadcrumbs={scope === 'own'
          ? undefined
          : [{ label: 'Reports', href: '/reports' }, { label: 'Sales by person' }]}
        title={scope === 'own' ? 'My sales' : 'Sales by person'}
        description={scope === 'own'
          ? 'What you have sold, and what it made. Nobody else\u2019s figures appear here.'
          : 'Ranked on profit, which is the figure the business runs on. Revenue rewards whoever was handed the expensive watches.'}
      />

      <ReportTabs tabs={reportTabs(user.role)} />

      {/* Filters in one row above the figures, as a set of links rather than
          a control that needs JavaScript to change a server-rendered page. */}
      <nav aria-label="Period" className="mb-6 flex flex-wrap gap-1.5">
        {(Object.keys(PERIODS) as PeriodKey[]).map((option) => (
          <Link
            key={option}
            href={`/reports/people?period=${option}`}
            aria-current={option === key ? 'page' : undefined}
            className={cn(
              'rounded-pill border px-3.5 py-1.5 text-caption font-semibold transition-colors',
              option === key
                ? 'border-content-primary bg-content-primary text-surface-raised'
                : 'border-line-subtle text-content-secondary hover:border-line-strong hover:text-content-primary',
            )}
          >
            {PERIODS[option].label}
          </Link>
        ))}
      </nav>

      <section aria-label="Totals for the period" className="mb-6 grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-4">
        <StatCard
          label="Sales"
          value={totals.sold}
          caption={key === 'all' ? 'all time' : movement(totals.sold, priorTotals.sold).text}
        />
        <StatCard
          label="Revenue"
          value={money(totals.revenue)}
          caption={key === 'all' ? 'gross, excluding fees' : movement(totals.revenue, priorTotals.revenue).text}
        />
        <StatCard
          label="Profit"
          value={signed(totals.profit)}
          tone="accent"
          caption={key === 'all' ? 'realised' : movement(totals.profit, priorTotals.profit).text}
        />
        <StatCard
          label="Weighted margin"
          value={totals.cost > 0 ? formatPct((totals.profit / totals.cost) * 100) : '—'}
          tone="accent"
          caption="profit over the cost of what sold"
        />
      </section>

      {partial && (
        <p className="mb-6 rounded-md border border-line-subtle bg-surface-subtle px-4 py-2.5 text-caption text-content-secondary">
          This period is still running. It is compared against the same number of days
          of the period before, not against a whole one.
        </p>
      )}

      {scope === 'own' && !me ? (
        <Card>
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="Your account is not linked to a salesperson yet"
            description="Until it is, there is no way to tell which sales are yours — so this shows nothing rather than guessing. Ask an owner to link you on the Sales people page."
          />
        </Card>
      ) : people.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="No sales in this period"
            description="Mark a watch as sold and name who closed it, and the month adds up here."
            action={<Link href="/reports/people?period=all" className="text-small font-bold text-content-accent hover:underline">Look at all time instead</Link>}
          />
        </Card>
      ) : (
        <div className={cn('grid items-start gap-6', scope === 'all' && 'lg:grid-cols-5')}>
          {scope === 'all' && (
          <ChartFrame
            className="lg:col-span-2"
            title="Realised profit"
            description={PERIODS[key].label.toLowerCase()}
            table={{
              columns: ['Person', 'Sold', 'Revenue', 'Profit'],
              rows: people.map((person) => ({
                label: person.name,
                values: [person.sold, money(person.revenue), signed(person.profit)],
              })),
            }}
          >
            <div className="px-6 py-5">
              <Bar data={bars} />
            </div>
          </ChartFrame>
          )}

          <Card className={cn('overflow-hidden', scope === 'all' && 'lg:col-span-3')}>
            <Table layout="fixed" minWidth="620px">
              <THead>
                <TR>
                  <TH width="150px">Person</TH>
                  <TH width="70px" align="right">Sold</TH>
                  <TH width="110px" align="right">Revenue</TH>
                  <TH width="110px" align="right">Profit</TH>
                  <TH width="90px" align="right">Margin</TH>
                  <TH width="110px" align="right">Avg sale</TH>
                </TR>
              </THead>
              <TBody>
                {people.map((person) => (
                  <TR key={person.id ?? 'unattributed'}>
                    <TD>
                      <span className="flex items-center gap-2">
                        {/* The mark carries identity; the name beside it is
                            in ink, never in the series colour. */}
                        {person.slot && (
                          <span
                            aria-hidden
                            className={cn('h-2.5 w-2.5 shrink-0 rounded-pill', SWATCH[person.slot])}
                          />
                        )}
                        <span className={cn(
                          'min-w-0 truncate font-bold',
                          person.id ? 'text-content-primary' : 'text-content-muted',
                        )}>
                          {person.name}
                        </span>
                      </span>
                      {person.lastSaleAt && (
                        <span className="mt-0.5 block text-caption text-content-secondary">
                          last sold {formatDate(person.lastSaleAt)}
                        </span>
                      )}
                    </TD>
                    <TD align="right" className="tabular-nums text-content-secondary">{person.sold}</TD>
                    <TD align="right" className="tabular-nums">{money(person.revenue)}</TD>
                    <TD align="right" className={cn(
                      'font-bold tabular-nums',
                      person.profit >= 0 ? 'text-content-accent' : 'text-state-danger',
                    )}>
                      {signed(person.profit)}
                      {key !== 'all' && (
                        <span className="block text-caption font-normal text-content-secondary">
                          {movement(person.profit, person.priorProfit).text}
                        </span>
                      )}
                    </TD>
                    <TD align="right" className="tabular-nums">
                      {person.margin !== null ? formatPct(person.margin) : '—'}
                    </TD>
                    <TD align="right" className="tabular-nums text-content-secondary">
                      {money(person.average)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {idle.length > 0 && (
              <div className="border-t border-line-subtle px-6 py-3.5 text-caption text-content-secondary">
                <span className="font-semibold text-content-primary">
                  No sales this period:
                </span>{' '}
                {idle.map((person) => person.name).join(', ')}.
              </div>
            )}
          </Card>
        </div>
      )}

      <p className="mt-6 text-caption text-content-secondary">
        {scope === 'own'
          ? 'A sale counts for you from the moment your name is put on it, which happens when it is booked. If one of yours is missing, ask whoever recorded it to name you on the sales ledger. Voided invoices count for nobody.'
          : 'A sale counts for whoever is named on it, which is set when it is booked and can be corrected afterwards from the sales ledger. Sales with nobody against them are shown as their own row rather than left out, so these figures always add up to the ledger. Voided invoices count for nobody.'}
      </p>
    </>
  )
}

/** The swatch beside a name, matching the bar on the chart. */
const SWATCH: Record<number, string> = {
  1: 'bg-chart-1', 2: 'bg-chart-2', 3: 'bg-chart-3',
  4: 'bg-chart-4', 5: 'bg-chart-5', 6: 'bg-chart-6',
}
