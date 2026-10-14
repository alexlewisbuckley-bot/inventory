import type { Metadata } from 'next'
import Link from 'next/link'
import { Wallet } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { commissionForMonth, commissionOn } from '@/server/repositories/sale-repository'
import { PageHeader } from '@/components/layout/PageHeader'
import { ReportTabs } from '@/components/reports/ReportTabs'
import { reportTabs } from '@/components/reports/tabs'
import { Card, StatCard, EmptyState, Table, THead, TBody, TR, TD, TH, LinkButton } from '@/components/ui'
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
 * A retainer every month, and a share of the profit on their own sales above
 * it. Monthly and fresh: a quiet month earns no commission and carries
 * nothing forward, so each column of this table stands on its own and
 * nobody has to hold a running balance in their head.
 *
 * Paid and unpaid are shown apart rather than added together. Commission on
 * an invoice the customer has not settled is money paid out before it came
 * in, and whether to do that is a decision about cash rather than about
 * arithmetic — so the page shows what is earned, what is waiting on payment,
 * and lets whoever signs the cheque decide.
 */
export default async function CommissionPage({ searchParams }: {
  searchParams: { month?: string }
}) {
  const user = await requireCapability('report:read')

  const choices = months()
  const chosen = choices.find((month) => month.key === searchParams.month) ?? choices[0]!

  const [rows, rates, preferences] = await Promise.all([
    commissionForMonth(chosen.from, chosen.to),
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
      // How much more profit this month needs before anything is earned.
      // More useful than a zero, which says the same thing and nothing else.
      toClear: Math.max(0, row.retainer - paid),
      payable: row.retainer + earned.commission,
    }
  })

  // Said out loud below the table rather than left to be inferred from a
  // column of zeros.
  const missing = people.filter((person) => person.retainer === 0)

  const totals = people.reduce(
    (sum, person) => ({
      retainer: sum.retainer + person.retainer,
      commission: sum.commission + person.commission,
      payable: sum.payable + person.payable,
      whenSettled: sum.whenSettled + person.whenSettled,
    }),
    { retainer: 0, commission: 0, payable: 0, whenSettled: 0 },
  )
  const outstanding = totals.whenSettled - totals.commission

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Commission' }]}
        title="Commission"
        description="A retainer every month, and a share of the profit on their own sales above it. Each month stands on its own."
      />

      <ReportTabs tabs={reportTabs(user.role)} />

      <nav aria-label="Month" className="mb-6 flex flex-wrap gap-1.5">
        {choices.slice(0, 6).map((month) => (
          <Link
            key={month.key}
            href={`/reports/commission?month=${month.key}`}
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
            {/* Commission leads, and is the only figure in accent. The
                total used to be called "Payable now" and shown in the same
                green beside it, which read as a commission bill five times
                the size of the real one. */}
            <StatCard label="Commission earned" value={money(totals.commission)} tone="accent" caption="a quarter of the profit above each retainer" />
            <StatCard
              label="Waiting on payment"
              value={money(outstanding)}
              caption={outstanding > 0 ? 'more commission once the rest settles' : 'nothing outstanding'}
            />
            <StatCard label="Retainers" value={money(totals.retainer)} caption="paid whatever sells" />
            <StatCard label="Total pay" value={money(totals.payable)} caption="retainers plus commission" />
          </section>

          <Card className="overflow-hidden">
            <Table layout="fixed" minWidth="940px">
              <THead>
                <TR>
                  <TH width="150px">Person</TH>
                  <TH width="120px" align="right">Retainer</TH>
                  <TH width="80px" align="right">Share</TH>
                  <TH width="150px" align="right">Profit (paid)</TH>
                  <TH width="150px" align="right">Above retainer</TH>
                  <TH width="130px" align="right">Commission</TH>
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
                      {person.above > 0 ? money(person.above) : (
                        // A zero says "none" and nothing else. This says how
                        // far off the month is, which is the thing somebody
                        // actually wants to know on the 14th.
                        <span className="text-content-secondary">
                          {person.toClear > 0 ? `${money(person.toClear)} to clear` : '—'}
                        </span>
                      )}
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
              ? `${missing.length === 1 ? `${missing[0]!.name} has` : `${missing.length} people have`} no retainer set, so commission runs from their first dirham of profit. Set one on `
              : 'Retainers and shares are set on '}
          <Link href="/sales-people" className="font-bold text-content-accent hover:underline">
            Sales people
          </Link>
          .
        </p>
      )}

      <p className="mt-6 text-caption text-content-secondary">
        The retainer is paid whatever sells. Commission is a quarter — or whatever share is
        set against each person — of the profit on the sales with their name on,
        <em> after</em> that month&rsquo;s profit has cleared their own retainer: on a
        retainer of AED 15,000 and a month making AED 20,000 of profit, AED 5,000 is above
        the retainer and the commission is a quarter of it, AED 1,250, for total pay of
        AED 16,250. Each month starts again, so a month that falls short earns nothing and
        carries nothing into the next. Only invoices marked paid count towards the figure
        shown as earned; the rest are listed beside it so you can see what is coming.
        Voided invoices count for nobody.
      </p>
    </>
  )
}
