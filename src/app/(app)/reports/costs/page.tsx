import type { Metadata } from 'next'
import Link from 'next/link'
import { requireCapability } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { listOverheads, monthlyCost, appliesInMonth } from '@/server/repositories/overhead-repository'
import { commissionForMonth, commissionOn } from '@/server/repositories/sale-repository'
import { isoDate } from '@/server/services/pnl-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { ReportTabs } from '@/components/reports/ReportTabs'
import { reportTabs } from '@/components/reports/tabs'
import { RunningCostsManager, type CostRow } from '@/components/reports/RunningCostsManager'
import { Card, StatCard } from '@/components/ui'
import { formatBase, isCurrency } from '@/lib/currency'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { DEFAULT_DISPLAY_CURRENCY, OVERHEAD_CATEGORY_LABELS } from '@/lib/enums'

export const metadata: Metadata = { title: 'Running costs' }
export const dynamic = 'force-dynamic'

/**
 * What the business costs to run.
 *
 * Split the way the money behaves rather than the way an accountant files
 * it: fixed costs are owed whether or not a watch sells, variable ones only
 * exist because one did. That is the split somebody needs when they are
 * working out how bad a quiet month would be.
 *
 * Commission is the only variable cost today and it is not typed in — it is
 * calculated from the sales with each person's name on. The retainers are
 * not typed in either. Both are read from Sales people, so there is nowhere
 * to enter a wage twice and no way for this page to disagree with the
 * commission report.
 */
export default async function RunningCostsPage() {
  const user = await requireCapability('report:read')
  const canManage = can(user.role, 'overhead:manage')

  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  const monthStart = isoDate(from)
  const monthEnd = isoDate(to)

  const [all, people, rates, preferences] = await Promise.all([
    listOverheads(),
    commissionForMonth(from, to),
    getRateTable(),
    getPreferencesFor(user.id),
  ])

  const currency = isCurrency(preferences?.displayCurrency)
    ? preferences.displayCurrency
    : DEFAULT_DISPLAY_CURRENCY
  const money = (base: number) => formatBase(base, currency, rates)

  const costs: CostRow[] = all.map((cost) => ({
    id: cost.id,
    name: cost.name,
    category: cost.category,
    amount: cost.amount,
    cadence: cost.cadence,
    monthly: monthlyCost(cost.amount, cost.cadence),
    startsOn: cost.startsOn,
    endsOn: cost.endsOn,
    notes: cost.notes,
    isActive: cost.isActive,
    current: cost.isActive && appliesInMonth(cost, monthStart, monthEnd),
  }))

  const typedFixed = costs.reduce((sum, cost) => sum + (cost.current ? cost.monthly : 0), 0)
  const retainers = people.reduce((sum, person) => sum + person.retainer, 0)
  const commission = people.reduce((sum, person) => sum
    + commissionOn(Number(person.paidProfit) + Number(person.pendingProfit), person.retainer, person.commissionBps).commission, 0)
  const fixed = typedFixed + retainers

  const byCategory = new Map<string, number>()
  for (const cost of costs) {
    if (!cost.current) continue
    byCategory.set(cost.category, (byCategory.get(cost.category) ?? 0) + cost.monthly)
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1])

  const month = from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Running costs' }]}
        title="Running costs"
        description="What the business costs to run before a watch is sold, and what each sale costs on top."
      />

      <ReportTabs tabs={reportTabs(user.role)} />

      <section aria-label={`This month, ${month}`} className="mb-6 grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-4">
        <StatCard label="Fixed, per month" value={money(fixed)} caption="owed whether anything sells or not" />
        <StatCard label="Commission" value={money(commission)} caption={`on ${month}'s sales so far`} />
        <StatCard label="Total this month" value={money(fixed + commission)} tone="accent" caption="before cost of stock" />
        <StatCard
          label="Retainers, of the fixed"
          value={money(retainers)}
          caption="from Sales people, not typed here"
        />
      </section>

      <RunningCostsManager costs={costs} canManage={canManage} />

      <section aria-label="Where it goes" className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-small font-bold text-content-primary">Fixed, by category</h2>
          <p className="mt-0.5 text-caption text-content-secondary">
            What {month} is committed to before anybody opens the door.
          </p>
          <dl className="mt-4 flex flex-col gap-2">
            {categories.length === 0 && retainers === 0 ? (
              <p className="text-small text-content-secondary">Nothing recorded yet.</p>
            ) : (
              <>
                {categories.map(([category, amount]) => (
                  <div key={category} className="flex items-baseline justify-between gap-3 border-b border-line-subtle pb-2 last:border-b-0">
                    <dt className="text-small text-content-secondary">
                      {OVERHEAD_CATEGORY_LABELS[category as keyof typeof OVERHEAD_CATEGORY_LABELS]}
                    </dt>
                    <dd className="text-small font-bold tabular-nums text-content-primary">{money(amount)}</dd>
                  </div>
                ))}
                {retainers > 0 && (
                  <div className="flex items-baseline justify-between gap-3 border-b border-line-subtle pb-2 last:border-b-0">
                    <dt className="text-small text-content-secondary">
                      Sales retainers
                      <Link href="/sales-people" className="ml-1.5 text-caption font-semibold text-content-accent hover:underline">
                        Sales people
                      </Link>
                    </dt>
                    <dd className="text-small font-bold tabular-nums text-content-primary">{money(retainers)}</dd>
                  </div>
                )}
              </>
            )}
          </dl>
        </Card>

        <Card className="p-6">
          <h2 className="text-small font-bold text-content-primary">Variable</h2>
          <p className="mt-0.5 text-caption text-content-secondary">
            Costs that exist only because something sold.
          </p>
          <dl className="mt-4 flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 border-b border-line-subtle pb-2">
              <dt className="text-small text-content-secondary">
                Commission
                <span className="block text-caption text-content-muted">
                  A quarter of the profit each person makes above their own retainer. Calculated, never typed.
                </span>
              </dt>
              <dd className="text-small font-bold tabular-nums text-content-primary">{money(commission)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-small text-content-secondary">
                Cost of stock
                <span className="block text-caption text-content-muted">
                  What each watch cost, taken off in the month it sold. It is on the profit and loss rather than here, because it belongs to the sale and not to the month.
                </span>
              </dt>
              <dd className="shrink-0 whitespace-nowrap text-small text-content-muted">per sale</dd>
            </div>
          </dl>
        </Card>
      </section>

      <p className="mt-6 text-caption text-content-secondary">
        A bill that falls quarterly or yearly is spread across the months it covers, so twelve
        months can be compared without the insurance making January look like a disaster. A
        one-off sits in its own month alone. A cost only counts for the months between the day
        it started and the day it stopped, so adding the rent today does not rewrite last year.
        Salespeople&rsquo;s retainers and commission are read from{' '}
        <Link href="/sales-people" className="font-bold text-content-accent hover:underline">Sales people</Link>
        {' '}rather than typed here, which is what stops a wage being counted twice.
      </p>
    </>
  )
}
