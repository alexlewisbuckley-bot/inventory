import type { Metadata } from 'next'
import Link from 'next/link'
import { Users } from 'lucide-react'
import { requireAnyCapability } from '@/server/auth/session'
import { salesByPersonWithBrokerage } from '@/server/services/brokerage-service'
import { commissionMonthsFor, commissionOverMonths } from '@/server/repositories/sale-repository'
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
import { formatPct, formatShare } from '@/lib/money'
import { salesScope } from '@/lib/permissions'
import { formatDate, businessToday, startOfMonthUtc, endOfMonthUtc, endOfDayUtc } from '@/lib/dates'
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
 *
 * Two things here used to come from the server's clock and should never
 * have:
 *
 * Which day it is. The server runs in UTC, the shop is in Dubai, and for
 * the last four hours of every UTC day they disagree about the date. A sale
 * booked on the shop floor at one in the morning carries that morning's
 * Dubai date, which the server still reads as tomorrow.
 *
 * Where the window ends. It ended at the current instant, so anything dated
 * later than right now fell outside a period it plainly belongs to. Those
 * two together are how a Patek sold in Dubai on the 27th was absent from
 * every figure on this page while sitting on the ledger behind it. A period
 * now runs to the end of its last day, and which day that is comes from
 * Dubai.
 *
 * The bounds are UTC midnights because that is how a sale date is stored —
 * the calendar day somebody picked, at 00:00Z — so the two line up exactly.
 */
function windowFor(key: PeriodKey): {
  from: Date | undefined
  to: Date | undefined
  prevFrom: Date | undefined
  prevTo: Date | undefined
  partial: boolean
} {
  const { year, month, day } = businessToday()
  if (key === 'all') {
    return { from: undefined, to: undefined, prevFrom: undefined, prevTo: undefined, partial: false }
  }
  if (key === 'month') {
    return {
      from: startOfMonthUtc(year, month),
      to: endOfMonthUtc(year, month),
      prevFrom: startOfMonthUtc(year, month - 1),
      prevTo: endOfMonthUtc(year, month - 1),
      partial: true,
    }
  }
  if (key === 'last') {
    return {
      from: startOfMonthUtc(year, month - 1),
      to: endOfMonthUtc(year, month - 1),
      prevFrom: startOfMonthUtc(year, month - 2),
      prevTo: endOfMonthUtc(year, month - 2),
      partial: false,
    }
  }
  if (key === 'year') {
    return {
      from: startOfMonthUtc(year, 0),
      to: endOfMonthUtc(year, 11),
      prevFrom: startOfMonthUtc(year - 1, 0),
      // The same point in last year, so the comparison stays year-to-date
      // against year-to-date rather than against a finished twelve months.
      prevTo: endOfDayUtc(year - 1, month, day),
      partial: true,
    }
  }
  // Rolling: three months back from today, to the end of today. A rolling
  // window is anchored on the day rather than the month, so this one ends
  // tonight rather than at the end of a period it does not have.
  const from = new Date(Date.UTC(year, month - 3, day))
  return {
    from,
    to: endOfDayUtc(year, month, day),
    prevFrom: new Date(Date.UTC(year, month - 6, day)),
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

  const [rows, previous, roster, rates, preferences, commissionMonths] = await Promise.all([
    // Includes brokered deals: a commission is a sale the person made and
    // the fee is profit they earned, so a leaderboard that left it out
    // would rank them on part of their month.
    salesByPersonWithBrokerage(from, to, onlyMine),
    key === 'all' ? Promise.resolve([]) : salesByPersonWithBrokerage(prevFrom, prevTo, onlyMine),
    // The roster is who else exists, which is not a scoped reader's business.
    scope === 'all' ? listSalesPeople() : Promise.resolve([]),
    getRateTable(),
    getPreferencesFor(user.id),
    /*
     * Their own commission, and only ever their own.
     *
     * Keyed on the salesperson this reader is linked to rather than on
     * anything in the URL, so there is no id to change. A manager reading
     * the whole book gets nothing here: the commission run is its own
     * report and this is the card a salesperson opens to see where they
     * are against their retainer.
     */
    me ? commissionMonthsFor(me.id, from, to) : Promise.resolve([]),
  ])

  const currency = isCurrency(preferences?.displayCurrency)
    ? preferences.displayCurrency
    : DEFAULT_DISPLAY_CURRENCY
  const money = (base: number) => formatBase(base, currency, rates)
  const signed = (base: number) => formatBaseSigned(base, currency, rates)

  const before = new Map(previous.map((row) => [row.personId ?? 'none', row]))

  /*
   * What this month is worth to the person reading it.
   *
   * Alex: "commision is paid on 25% of profit we can display that to sales
   * staff and also their retainer amount if they have one which they have
   * to surpass."
   *
   * The share and the retainer are the person's own terms rather than a
   * rate written in here, because they already are: 25% is the default a
   * new salesperson is created on, and somebody on different terms is
   * shown theirs.
   *
   * Stock sales only, which is what the commission run has always paid on
   * and what the profit column on the sales ledger holds. A brokered fee
   * is in the Profit card above and not in this one, so each card says
   * which profit it means rather than leaving somebody to work out why a
   * quarter of one is not the other.
   *
   * Worked out one month at a time even when the period is a quarter or a
   * year. The retainer is monthly and a quiet month owes nothing forward,
   * so a quarter is three separate settlements — taking the share of the
   * lump sum and deducting one retainer would pay somebody for two months
   * they never cleared.
   */
  const commission = me
    ? commissionOverMonths(commissionMonths, me.retainer, me.commissionBps)
    : null
  /*
   * "How much more do I need to sell this month?", as a figure.
   *
   * Only asked of a single month, because only a single month has an
   * answer: each month settles on its own and a past one is closed, so
   * there is no running shortfall to carry. Over a longer period the
   * honest summary is how many months got there, which is the card below.
   *
   * Measured on what they have sold rather than on what the customer has
   * paid — the retainer is a question about selling.
   */
  const singleMonth = key === 'month' || key === 'last'
  const toClear = me && commission && singleMonth
    ? Math.max(0, me.retainer - commission.projectedEarned)
    : 0

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
      /** The same numerator, kept so the headline margin can agree with this one. */
      stockProfit: Number(row.stockProfitGbp),
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
      stockProfit: sum.stockProfit + person.stockProfit,
    }),
    { sold: 0, revenue: 0, profit: 0, cost: 0, stockProfit: 0 },
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
        {/*
          * Stock profit over stock cost — the same arithmetic as the margin
          * on each person's row, so a page showing one person cannot show
          * two different margins for them.
          *
          * It was `totals.profit`, which includes brokered fees and buy-back
          * charges. Those have no cost under them, so every fee earned
          * pushed this figure up without moving the denominator: one stock
          * sale at 5.3% beside a brokered fee read as a weighted margin of
          * 20.9%. The warning against exactly this is written over the row
          * calculation above, and this card did it anyway.
          */}
        <StatCard
          label="Weighted margin"
          value={totals.cost > 0 ? formatPct((totals.stockProfit / totals.cost) * 100) : '—'}
          tone="accent"
          caption="profit over the cost of the stock sold"
        />
      </section>

      {me && commission && (
        <section aria-label="Your commission" className="mb-6 grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-4">
          <StatCard
            label="Commission earned"
            value={money(commission.paidCommission)}
            tone="accent"
            caption={`${formatShare(me.commissionBps)} of profit on watches you sold, on invoices that are paid`}
          />
          <StatCard
            label="If everything settles"
            value={money(commission.projectedCommission)}
            caption={commission.projectedCommission > commission.paidCommission
              ? 'including invoices still outstanding'
              : 'nothing outstanding'}
          />
          {me.retainer > 0 && (
            <>
              <StatCard
                label="Your retainer"
                value={money(me.retainer)}
                caption="a month, drawn against commission"
              />
              {singleMonth ? (
                <StatCard
                  label="Past your retainer"
                  value={toClear > 0 ? 'Not yet' : 'Yes'}
                  tone={toClear > 0 ? undefined : 'accent'}
                  caption={toClear > 0
                    ? `${money(toClear)} more of profit share to cover it`
                    : 'commission is paid on top from here'}
                />
              ) : (
                <StatCard
                  label="Months cleared"
                  value={`${commission.clearedMonths} of ${commission.months}`}
                  tone={commission.clearedMonths > 0 ? 'accent' : undefined}
                  caption={commission.months === 1 ? 'month you sold in' : 'months you sold in'}
                />
              )}
            </>
          )}
        </section>
      )}

      {me && commission && me.retainer > 0 && (
        <p className="mb-6 rounded-md border border-line-subtle bg-surface-subtle px-4 py-2.5 text-caption text-content-secondary">
          Your retainer is an advance against commission: you are paid {formatShare(me.commissionBps)} of
          the profit on the watches you sell, and commission reaches you once that share passes
          the retainer you have already drawn. A month that does not get there owes nothing
          forward — each month starts again.
        </p>
      )}

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
