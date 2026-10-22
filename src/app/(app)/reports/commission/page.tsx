import type { Metadata } from 'next'
import Link from 'next/link'
import { Target, Wallet } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { commissionOn } from '@/server/repositories/sale-repository'
import { commissionBaseForMonth } from '@/server/services/brokerage-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { ReportTabs } from '@/components/reports/ReportTabs'
import { reportTabs } from '@/components/reports/tabs'
import { Card, StatCard, EmptyState, Table, THead, TBody, TR, TD, TH, LinkButton } from '@/components/ui'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { TargetMeter, type MeterState } from '@/components/charts/TargetMeter'
import { formatBase, isCurrency } from '@/lib/currency'
import { formatShare } from '@/lib/money'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { DEFAULT_DISPLAY_CURRENCY } from '@/lib/enums'
import { cn } from '@/lib/cn'

export const metadata: Metadata = { title: 'Commission' }
export const dynamic = 'force-dynamic'

/** The twelve months back from this one, as the picker offers them. */
function months(count = 12): Array<{ key: string; label: string; from: Date; to: Date }> {
  const now = new Date()
  return Array.from({ length: count }, (_, index) => {
    const from = new Date(now.getFullYear(), now.getMonth() - index, 1)
    const to = new Date(now.getFullYear(), now.getMonth() - index + 1, 0, 23, 59, 59, 999)
    return {
      key: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`,
      label: from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      from,
      to,
    }
  })
}

/**
 * What each salesperson is owed this month.
 *
 * A retainer every month, advanced against a share of the profit on their
 * own sales: the share is what they earn, and the retainer has already been
 * paid out of it, so only the part above the retainer is money on top.
 *
 * This was built the other way round first — the retainer taken off the
 * profit, then a quarter of what was left — which pays somebody AED 854 in
 * a month whose whole commission came to AED 1,875 against a AED 4,085
 * advance. Both readings fit "25% of profit beyond their retainer", and the
 * worked example that was meant to settle it happened to give the same
 * answer under each.
 *
 * Monthly and fresh: a quiet month earns no commission and carries nothing
 * forward, so each column of this table stands on its own and nobody has to
 * hold a running balance in their head. Nothing is clawed back either — a
 * retainer the quarter never covered is simply not recovered.
 *
 * Paid and unpaid are shown apart rather than added together. Commission on
 * an invoice the customer has not settled is money paid out before it came
 * in, and whether to do that is a decision about cash rather than about
 * arithmetic — so the page shows what is earned, what is waiting on payment,
 * and lets whoever signs the cheque decide.
 */
export default async function CommissionPage({ searchParams }: {
  searchParams: { month?: string; view?: string }
}) {
  const user = await requireCapability('report:read')

  const choices = months()
  const chosen = choices.find((month) => month.key === searchParams.month) ?? choices[0]!
  const view = searchParams.view === 'target' ? 'target' : 'figures'

  const [rows, rates, preferences] = await Promise.all([
    commissionBaseForMonth(chosen.from, chosen.to),
    getRateTable(),
    getPreferencesFor(user.id),
  ])

  const currency = isCurrency(preferences?.displayCurrency)
    ? preferences.displayCurrency
    : DEFAULT_DISPLAY_CURRENCY
  const money = (base: number) => formatBase(base, currency, rates)

  const people = rows.map((row) => {
    const paid = Number(row.paidProfit)
    const pending = Number(row.pendingProfit)
    const earned = commissionOn(paid, row.retainer, row.commissionBps)
    // What the same month would come to if everything outstanding were
    // settled — not a second commission, the same one with the rest of the
    // month's invoices paid.
    const ifAllPaid = commissionOn(paid + pending, row.retainer, row.commissionBps)
    return {
      ...row,
      paid,
      pending,
      paidCount: Number(row.paidCount),
      pendingCount: Number(row.pendingCount),
      ...earned,
      whenSettled: ifAllPaid.commission,
      // How much more the quarter has to come to before anything is due on
      // top of the retainer. More useful than a zero, which says the same
      // thing and nothing else.
      toClear: Math.max(0, row.retainer - earned.earned),
      payable: row.retainer + earned.commission,
    }
  })

  // Said out loud below the table rather than left to be inferred from a
  // column of zeros.
  const missing = people.filter((person) => person.retainer === 0)

  const totals = people.reduce(
    (sum, person) => ({
      retainer: sum.retainer + person.retainer,
      earned: sum.earned + person.earned,
      commission: sum.commission + person.commission,
      payable: sum.payable + person.payable,
      whenSettled: sum.whenSettled + person.whenSettled,
    }),
    { retainer: 0, earned: 0, commission: 0, payable: 0, whenSettled: 0 },
  )
  const outstanding = totals.whenSettled - totals.commission

  /**
   * How far through the month we are, for the mark on each track.
   *
   * Only for the month still running. On a month already over the whole
   * track is the deadline, and a mark part-way along it would suggest there
   * is still time.
   */
  const now = Date.now()
  const pace = now >= chosen.from.getTime() && now <= chosen.to.getTime()
    ? (now - chosen.from.getTime()) / (chosen.to.getTime() - chosen.from.getTime())
    : undefined

  /**
   * One row per person who has a target to be measured against.
   *
   * Somebody with no retainer has no target, so there is no meaningful bar
   * to draw them — a full track would say they had cleared something and an
   * empty one would say they had failed to. They are named underneath
   * instead.
   */
  const targets = people.filter((person) => person.retainer > 0).map((person) => {
    // The quarter against the retainer, not the profit against it: the
    // retainer is an advance on commission, so what has to cover it is the
    // commission, and this bar is literally "1,875 of 4,085".
    const ratio = person.earned / person.retainer
    const cleared = person.earned >= person.retainer
    // Behind is measured against the clock while the month is running, and
    // against the whole month once it is over. Without the clock, every row
    // reads as a failure for the first three weeks of every month.
    const behind = !cleared && (pace === undefined || ratio < pace)
    const state: MeterState = cleared ? 'cleared' : behind ? 'behind' : 'onTrack'
    return {
      person,
      label: person.name,
      ratio,
      display: `${Math.round(Math.max(ratio, 0) * 100)}%`,
      state,
      stateLabel: cleared
        ? `${money(person.commission)} commission`
        : behind ? 'Behind' : 'On track',
      caption: cleared
        ? `${money(person.earned)} earned on ${money(person.paid)} of profit, ${money(person.commission)} above the retainer`
        // "−AED 48,067 of AED 25,000" is not how anybody says a month that
        // lost money, and the minus sign is easy to miss at caption size.
        : person.paid < 0
          ? `${money(-person.paid)} lost against a ${money(person.retainer)} retainer · ${money(person.toClear)} to clear`
          : `${money(person.earned)} of ${money(person.retainer)} · ${money(person.toClear)} to clear`,
    }
  })

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Commission' }]}
        title="Commission"
        description="A retainer every month, advanced against a share of the profit on their own sales. Each month stands on its own."
      />

      <ReportTabs tabs={reportTabs(user.role)} />

      <nav aria-label="Month" className="mb-6 flex flex-wrap gap-1.5">
        {choices.slice(0, 6).map((month) => (
          <Link
            key={month.key}
            href={`/reports/commission?month=${month.key}${view === 'target' ? '&view=target' : ''}`}
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

      {/* Two readings of one month. The figures are what gets paid; the
          meters are who is going to clear their retainer, which is the
          question somebody asks in the middle of the month rather than at
          the end of it. */}
      <nav aria-label="View" className="mb-6 flex gap-1.5">
        {([['figures', 'Figures'], ['target', 'Against target']] as const).map(([key, label]) => (
          <Link
            key={key}
            href={`/reports/commission?month=${chosen.key}${key === 'target' ? '&view=target' : ''}`}
            aria-current={key === view ? 'page' : undefined}
            className={cn(
              'rounded-sm px-3 py-1.5 text-caption font-semibold transition-colors',
              key === view
                ? 'bg-surface-subtle text-content-primary'
                : 'text-content-secondary hover:text-content-primary',
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {people.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet className="h-6 w-6" />}
            title="Nobody is on the sales team yet"
            description="Add the people who sell, give each a retainer and a share, and this is where the month adds up."
            action={<LinkButton href="/sales-people">Sales people</LinkButton>}
          />
        </Card>
      ) : (
        <>
          <section aria-label="The month" className="mb-6 grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-4">
            {/* Two commission figures, because there are two: what the
                quarter came to, and what is left of it once each person's
                retainer — an advance on that same quarter — is covered.
                Only the second is money anybody is handed. */}
            <StatCard label="Earned at 25%" value={money(totals.earned)} caption="a quarter of the profit on their own sales" />
            <StatCard
              label="Due above retainers"
              value={money(totals.commission)}
              tone="accent"
              caption={totals.commission > 0 ? 'on top of the retainers' : 'nobody has covered their advance yet'}
            />
            <StatCard label="Retainers" value={money(totals.retainer)} caption="paid whatever sells, and advanced against the quarter" />
            <StatCard label="Total pay" value={money(totals.payable)} caption="retainers plus what is due above them" />
          </section>

          {view === 'target' ? (
            targets.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Target className="h-6 w-6" />}
                  title="Nobody has a target yet"
                  description="A retainer is the target. Give each person theirs and this shows how close they are to clearing it."
                  action={<LinkButton href="/sales-people">Sales people</LinkButton>}
                />
              </Card>
            ) : (
              <ChartFrame
                title={`Commission against retainer, ${chosen.label}`}
                description={pace === undefined
                  ? 'The month is over: the whole track is what had to be cleared.'
                  : `The mark on each track is today — ${Math.round(pace * 100)}% of the way through the month.`}
                legend={[
                  { label: 'Covered — commission due on top', swatchClassName: 'bg-state-good' },
                  { label: 'Still covering the retainer', swatchClassName: 'bg-chart-seq-4' },
                ]}
                table={{
                  columns: ['Person', 'Profit', 'Earned at 25%', 'Retainer', 'Of retainer', 'Due above it'],
                  rows: targets.map(({ person, label, display }) => ({
                    label,
                    values: [
                      money(person.paid), money(person.earned), money(person.retainer),
                      display, money(person.commission),
                    ],
                  })),
                }}
              >
                <TargetMeter data={targets} pace={pace} />
              </ChartFrame>
            )
          ) : (
          <Card className="overflow-hidden">
            <Table layout="fixed" minWidth="940px">
              <THead>
                <TR>
                  <TH width="150px">Person</TH>
                  <TH width="120px" align="right">Retainer</TH>
                  <TH width="80px" align="right">Share</TH>
                  <TH width="150px" align="right">Profit (paid)</TH>
                  <TH width="170px" align="right">Earned at their share</TH>
                  <TH width="130px" align="right">Due above retainer</TH>
                  <TH width="130px" align="right">Total pay</TH>
                </TR>
              </THead>
              <TBody>
                {people.map((person) => (
                  <TR key={person.personId}>
                    <TD className="font-bold text-content-primary">{person.name}</TD>
                    <TD align="right" className="tabular-nums text-content-secondary">
                      {/* A recorded zero and an unanswered question look the
                          same in this column, and they are not the same: on
                          zero, commission runs from the first dirham. */}
                      {person.retainer > 0
                        ? money(person.retainer)
                        : <span className="text-content-muted">Not set</span>}
                    </TD>
                    <TD align="right" className="tabular-nums text-content-secondary">
                      {formatShare(person.commissionBps)}
                    </TD>
                    <TD align="right" className="tabular-nums">
                      {money(person.paid)}
                      <span className="block text-caption text-content-secondary">
                        {/* "0 sales" beside an unpaid figure reads as a
                            contradiction. Say paid when there is something
                            unpaid to tell it apart from. */}
                        {person.pendingCount > 0
                          ? `${person.paidCount} paid · ${money(person.pending)} unpaid`
                          : `${person.paidCount} ${person.paidCount === 1 ? 'sale' : 'sales'}`}
                      </span>
                    </TD>
                    <TD align="right" className="tabular-nums">
                      {money(person.earned)}
                      {/* The quarter is what the retainer is an advance on,
                          so what matters beside it is how much of that
                          advance it has covered. A bare zero would say the
                          same thing and nothing else. */}
                      <span className="block text-caption text-content-secondary">
                        {person.retainer === 0
                          ? 'no retainer to cover'
                          : person.toClear > 0
                            ? `${money(person.toClear)} short of the retainer`
                            : 'retainer covered'}
                      </span>
                    </TD>
                    <TD align="right" className={cn(
                      'font-bold tabular-nums',
                      person.commission > 0 ? 'text-content-accent' : 'text-content-muted',
                    )}>
                      {money(person.commission)}
                      {person.whenSettled > person.commission && (
                        <span className="block text-caption font-normal text-content-secondary">
                          {money(person.whenSettled)} if all settles
                        </span>
                      )}
                    </TD>
                    <TD align="right" className="font-bold tabular-nums">{money(person.payable)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          )}
        </>
      )}

      {people.length > 0 && (
        <p className="mt-4 text-small text-content-secondary">
          {/* Nobody reading a wage figure should have to work out whether a
              zero is the answer or the absence of one. Somebody with no
              retainer earns commission from the first dirham, which is a
              real arrangement and also exactly what an unfinished setup
              looks like, so the count is said out loud. */}
          {missing.length === people.length
            ? 'Nobody has a retainer yet, so everybody here earns commission from the first dirham. Set one, and the share above it, on '
            : missing.length > 0
              ? `${missing.length === 1 ? `${missing[0]!.name} has` : `${missing.length} people have`} no retainer set, so commission runs from their first dirham of profit${view === 'target' ? ' and there is no target to chart them against' : ''}. Set one on `
              : 'Retainers and shares are set on '}
          <Link href="/sales-people" className="font-bold text-content-accent hover:underline">
            Sales people
          </Link>
          .
        </p>
      )}

      <p className="mt-6 text-caption text-content-secondary">
        The retainer is paid whatever sells, and it is an advance against commission rather
        than a slice taken off the profit first. Each person earns a quarter — or whatever
        share is set against them — of the profit on the sales with their name on, and that
        quarter has to cover their retainer before anything further is due: on a retainer of
        AED 15,000 and a month making AED 40,000 of profit, the quarter is AED 10,000, which
        does not cover it, so pay is the AED 15,000 retainer and nothing more. The same
        person making AED 80,000 of profit earns AED 20,000, which covers the retainer with
        AED 5,000 to spare, for total pay of AED 20,000. Each month starts again, so a month
        that falls short carries nothing into the next and nothing is clawed back. Only
        invoices marked paid count towards the figure shown as earned; the rest are listed
        beside it so you can see what is coming. Voided invoices count for nobody.
      </p>
    </>
  )
}
