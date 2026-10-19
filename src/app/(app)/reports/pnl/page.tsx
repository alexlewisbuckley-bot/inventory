import type { Metadata } from 'next'
import Link from 'next/link'
import { requireCapability } from '@/server/auth/session'
import { profitAndLoss, type PnlMonth } from '@/server/services/pnl-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { ReportTabs } from '@/components/reports/ReportTabs'
import { reportTabs } from '@/components/reports/tabs'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { DivergingBar } from '@/components/charts/DivergingBar'
import { Card, StatCard } from '@/components/ui'
import { formatBase, isCurrency } from '@/lib/currency'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { DEFAULT_DISPLAY_CURRENCY, OVERHEAD_CATEGORY_LABELS } from '@/lib/enums'
import { cn } from '@/lib/cn'

export const metadata: Metadata = { title: 'Profit & loss' }
export const dynamic = 'force-dynamic'

/** The months the picker offers, newest first. */
function months(count = 12): Array<{ key: string; label: string; short: string; from: Date; to: Date }> {
  const now = new Date()
  return Array.from({ length: count }, (_, index) => {
    const from = new Date(now.getFullYear(), now.getMonth() - index, 1)
    const to = new Date(now.getFullYear(), now.getMonth() - index + 1, 0, 23, 59, 59, 999)
    return {
      key: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`,
      label: from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      short: from.toLocaleDateString('en-GB', { month: 'short' }),
      from,
      to,
    }
  })
}

/**
 * What the month actually came to.
 *
 * The system has reported gross profit since the beginning and never net,
 * because the rent was not in it. A dealer looking at AED 74,000 of gross
 * profit has had no way to tell from this screen whether that was a good
 * month, and that is the question the figures exist to answer.
 *
 * Read top to bottom as a statement rather than spread across tiles: each
 * line is the one above it less something, and an arrangement that lets a
 * reader check the arithmetic is worth more here than one that looks
 * livelier. The tiles above carry only what somebody scanning wants —
 * what came in, what was left, and whether that is better or worse than
 * the month before.
 */
export default async function PnlPage({ searchParams }: { searchParams: { month?: string } }) {
  const user = await requireCapability('report:read')

  const choices = months()
  const chosen = choices.find((month) => month.key === searchParams.month) ?? choices[0]!
  const previous = choices[choices.indexOf(chosen) + 1]

  const [statement, before, trend, rates, preferences] = await Promise.all([
    profitAndLoss(chosen.from, chosen.to),
    previous ? profitAndLoss(previous.from, previous.to) : Promise.resolve(null),
    Promise.all(choices.slice(0, 6).map(async (month) => ({
      month,
      pnl: await profitAndLoss(month.from, month.to),
    }))),
    getRateTable(),
    getPreferencesFor(user.id),
  ])

  const currency = isCurrency(preferences?.displayCurrency)
    ? preferences.displayCurrency
    : DEFAULT_DISPLAY_CURRENCY
  const money = (base: number) => formatBase(base, currency, rates)

  const lines = statementLines(statement)
  const change = before ? statement.netProfit - before.netProfit : null

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Profit & loss' }]}
        title="Profit & loss"
        description="From what was invoiced down to what was left, month by month."
      />

      <ReportTabs tabs={reportTabs(user.role)} />

      <nav aria-label="Month" className="mb-6 flex flex-wrap gap-1.5">
        {choices.slice(0, 6).map((month) => (
          <Link
            key={month.key}
            href={`/reports/pnl?month=${month.key}`}
            aria-current={month.key === chosen.key ? 'page' : undefined}
            className={cn(
              'rounded-pill border px-3.5 py-1.5 text-caption font-semibold transition-colors',
              month.key === chosen.key
                ? 'border-content-primary bg-content-primary text-surface-raised'
                : 'border-line-subtle text-content-secondary hover:border-line-strong hover:text-content-primary',
            )}
          >
            {month.label}
          </Link>
        ))}
      </nav>

      <section aria-label="The month" className="mb-6 grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-4">
        <StatCard
          label="Invoiced"
          value={money(statement.invoiced)}
          caption={`${statement.saleCount} ${statement.saleCount === 1 ? 'sale' : 'sales'}`}
        />
        <StatCard label="Gross profit" value={money(statement.grossProfit)} caption="after the cost of the stock" />
        <StatCard label="Running costs" value={money(statement.totalCosts)} caption="wages, commission and overheads" />
        <StatCard
          label="Net profit"
          value={money(statement.netProfit)}
          tone={statement.netProfit >= 0 ? 'accent' : 'danger'}
          caption={change === null
            ? 'what the month left'
            : change === 0 ? 'the same as last month'
              : `${money(Math.abs(change))} ${change > 0 ? 'better' : 'worse'} than last month`}
        />
      </section>

      {/*
        What the bottom line could not see.

        A profit and loss built on blanks still prints a number, and the
        number is always too good — a cost nobody entered is a cost this
        cannot charge, and a sale with no name on it earns no commission.
        Read before the statement rather than footnoted after it, because
        somebody who has been told the month made money has already stopped
        reading.
      */}
      {(statement.blindSpots.unattributed.count > 0
        || statement.blindSpots.peopleWithoutRetainer > 0
        || statement.blindSpots.overheadCount === 0) && (
        <Card className="mb-6 border-state-warning/40 bg-state-warning/5 p-6">
          <h2 className="text-small font-bold text-content-primary">
            What this month cannot see
          </h2>
          <p className="mt-0.5 text-caption text-content-secondary">
            Each of these makes the figure below better than the month really was.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {/* Two different failures that look identical on the bottom
                line. Nothing entered is a gap somebody has to fill; entered
                but dated to start later is a cost that is already correct
                and simply is not this month's — and saying "none recorded"
                about it would send somebody hunting for a row that is
                already there. */}
            {statement.blindSpots.overheadCount === 0
              && statement.blindSpots.overheadsRecorded === 0 && (
              <li className="text-small text-content-secondary">
                <span className="font-semibold text-content-primary">
                  No running costs are recorded at all.
                </span>{' '}
                Rent, insurance and salaries are charged from{' '}
                <Link href="/reports/costs" className="font-bold text-content-accent hover:underline">
                  Running costs
                </Link>
                , and with nothing entered the business appears to have none.
              </li>
            )}
            {statement.blindSpots.startingLater.length > 0 && (
              <li className="text-small text-content-secondary">
                <span className="font-semibold text-content-primary">
                  {statement.blindSpots.startingLater.length === 1
                    ? `${statement.blindSpots.startingLater[0]!.name} is recorded but does not start until `
                    : `${statement.blindSpots.startingLater.length} running costs are recorded but do not start until `}
                  {statement.blindSpots.startingLater
                    .map((cost) => new Date(`${cost.startsOn}T00:00:00`)
                      .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))
                    .filter((month, index, all) => all.indexOf(month) === index)
                    .join(' and ')}
                  .
                </span>{' '}
                {statement.blindSpots.startingLater.length === 1 ? 'Nothing is' : 'None of it is'}{' '}
                charged to {chosen.label}, so this month shows the business paying
                {statement.blindSpots.overheadCount === 0 ? ' no overheads whatever' : ' less than it will'}.
                If {statement.blindSpots.startingLater.length === 1 ? 'it has' : 'they have'} been
                running longer than that, correct the start date on{' '}
                <Link href="/reports/costs" className="font-bold text-content-accent hover:underline">
                  Running costs
                </Link>.
              </li>
            )}
            {statement.blindSpots.peopleWithoutRetainer > 0 && (
              <li className="text-small text-content-secondary">
                <span className="font-semibold text-content-primary">
                  {statement.blindSpots.peopleWithoutRetainer} of{' '}
                  {statement.blindSpots.peopleTotal} salespeople have no retainer recorded.
                </span>{' '}
                A retainer of zero is charged as zero, so their wages are missing from the
                costs below. Set them on{' '}
                <Link href="/sales-people" className="font-bold text-content-accent hover:underline">
                  Sales people
                </Link>.
              </li>
            )}
            {statement.blindSpots.unattributed.count > 0 && (
              <li className="text-small text-content-secondary">
                <span className="font-semibold text-content-primary">
                  {statement.blindSpots.unattributed.count}{' '}
                  {statement.blindSpots.unattributed.count === 1 ? 'sale has' : 'sales have'}{' '}
                  no salesperson on {statement.blindSpots.unattributed.count === 1 ? 'it' : 'them'}.
                </span>{' '}
                Commission is worked out per person, so the{' '}
                {money(statement.blindSpots.unattributed.profit)} of profit on{' '}
                {statement.blindSpots.unattributed.count === 1 ? 'it' : 'those'} has had none
                charged against it. Put a name on{' '}
                {statement.blindSpots.unattributed.count === 1 ? 'the sale' : 'each sale'} and
                this month will cost more than it currently says.
              </li>
            )}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card className="p-6">
          <h2 className="text-small font-bold text-content-primary">{chosen.label}</h2>
          <p className="mt-0.5 text-caption text-content-secondary">
            Every sale invoiced this month, whether or not it has been paid.
          </p>

          <dl className="mt-5">
            {lines.map((line) => (
              <div
                key={line.label}
                className={cn(
                  'flex items-baseline justify-between gap-4 py-2',
                  line.rule && 'border-t border-line-strong',
                  line.indent && 'pl-4',
                )}
              >
                <dt className={cn(
                  'text-small',
                  line.total ? 'font-bold text-content-primary' : 'text-content-secondary',
                )}>
                  {line.label}
                  {line.caption && (
                    <span className="block text-caption text-content-muted">{line.caption}</span>
                  )}
                </dt>
                <dd className={cn(
                  'shrink-0 tabular-nums',
                  line.total ? 'text-small font-bold' : 'text-small',
                  line.total && line.value < 0 ? 'text-state-danger'
                    : line.total ? 'text-content-primary' : 'text-content-secondary',
                )}>
                  {/* One minus sign down the column. The deduction rows
                      render U+2212 and the totals were falling through to
                      Intl's hyphen, so a loss was punctuated differently
                      from the costs that caused it. */}
                  {line.value < 0
                    ? `− ${money(Math.abs(line.value))}`
                    : line.negative && line.value !== 0
                      ? `− ${money(line.value)}`
                      : money(line.value)}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 border-t border-line-subtle pt-4 text-caption text-content-secondary">
            Cost of stock is what each watch was bought for and nothing else. Servicing,
            polishing, shipping, duty and card fees are not in it, so gross profit is the
            margin on the metal rather than the cost of getting it sold. Put those in{' '}
            <Link href="/reports/costs" className="font-bold text-content-accent hover:underline">
              Running costs
            </Link>{' '}
            if you want them against the month.
          </p>
          <p className="mt-2 text-caption text-content-secondary">
            {statement.unpaid > 0 ? (
              <>
                <span className="font-semibold text-content-primary">{money(statement.received)}</span>
                {' of that has actually been received. '}
                <span className="font-semibold text-content-primary">{money(statement.unpaid)}</span>
                {' is invoiced and still outstanding, so the profit above is earned rather than banked.'}
              </>
            ) : (
              'Every invoice in this month has been paid, so the profit above is banked as well as earned.'
            )}
          </p>
        </Card>

        <ChartFrame
          title="Net profit, six months"
          description="The run rate behind this month, so one good or bad month is read in context."
          legend={[
            { label: 'Profit', swatchClassName: 'bg-chart-div-5' },
            { label: 'Loss', swatchClassName: 'bg-chart-div-1' },
          ]}
          table={{
            columns: ['Month', 'Gross profit', 'Costs', 'Net'],
            rows: trend.map(({ month, pnl }) => ({
              label: month.label,
              values: [money(pnl.grossProfit), money(pnl.totalCosts), money(pnl.netProfit)],
            })),
          }}
        >
          <DivergingBar
            data={[...trend].reverse().map(({ month, pnl }) => ({
              label: month.label,
              value: pnl.netProfit,
              display: money(pnl.netProfit),
              emphasis: month.key === chosen.key,
              href: `/reports/pnl?month=${month.key}`,
            }))}
          />
        </ChartFrame>
      </div>

      <p className="mt-6 text-caption text-content-secondary">
        A sale counts in the month it was invoiced, paid or not, which is how the accounts
        read. Commission is charged against the month that earned it for the same reason —
        the revenue on an unpaid invoice has already been counted a few lines above, so
        leaving its commission out would flatter the month.{' '}
        {statement.commission !== statement.commissionPayable && (
          <>
            Of the {money(statement.commission)} accrued, {money(statement.commissionPayable)} is
            payable now; the rest falls due as those invoices settle, which is the figure the{' '}
            <Link href="/reports/commission" className="font-bold text-content-accent hover:underline">
              commission report
            </Link>
            {' '}shows.{' '}
          </>
        )}
        Retainers and overheads are this month&rsquo;s, from{' '}
        <Link href="/sales-people" className="font-bold text-content-accent hover:underline">Sales people</Link>
        {' and '}
        <Link href="/reports/costs" className="font-bold text-content-accent hover:underline">Running costs</Link>.
        A retainer carries no history, so changing one restates every month; a running cost
        has a start and an end and does not.
      </p>
    </>
  )
}

interface Line {
  label: string
  value: number
  caption?: string
  /** Shown with a minus, because it is coming off the line above. */
  negative?: boolean
  /** A subtotal: heavier, and ruled off from what made it. */
  total?: boolean
  rule?: boolean
  indent?: boolean
}

/**
 * The statement, in the order it has to be read.
 *
 * Built as data rather than markup so the order and the arithmetic sit in
 * one place: a line that was rendered by hand could be moved without its
 * subtotal moving with it.
 */
function statementLines(pnl: PnlMonth): Line[] {
  const overheadsByCategory = new Map<string, number>()
  for (const line of pnl.overheadLines) {
    overheadsByCategory.set(line.category, (overheadsByCategory.get(line.category) ?? 0) + line.monthly)
  }

  return [
    { label: 'Invoiced', value: pnl.invoiced },
    { label: 'Cost of stock sold', value: pnl.costOfStock, negative: true },
    { label: 'Gross profit', value: pnl.grossProfit, total: true, rule: true },

    { label: 'Retainers', value: pnl.retainers, negative: true, caption: 'the sales floor, paid whatever sells' },
    { label: 'Commission', value: pnl.commission, negative: true, caption: 'what is due on top of the retainers, which are an advance against the same quarter' },
    ...[...overheadsByCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, amount]) => ({
        label: OVERHEAD_CATEGORY_LABELS[category as keyof typeof OVERHEAD_CATEGORY_LABELS],
        value: amount,
        negative: true,
        indent: false,
      })),
    { label: 'Total running costs', value: pnl.totalCosts, negative: true, total: true, rule: true },

    { label: 'Net profit', value: pnl.netProfit, total: true, rule: true },
  ]
}
