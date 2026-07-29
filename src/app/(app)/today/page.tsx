import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { requireUser } from '@/server/auth/session'
import { agendaFor } from '@/server/services/crm-service'
import {
  pipelineSnapshot, quietDaySummary, stockSnapshot, waitingOnThem, worthKnowing,
} from '@/server/services/insights-service'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui'
import { Agenda } from '@/components/today/Agenda'
import { WorthKnowing } from '@/components/today/WorthKnowing'
import { formatBase, isCurrency } from '@/lib/currency'
import { BASE_CURRENCY, DEAL_STAGE_LABELS, type DealStage } from '@/lib/enums'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Today' }
export const dynamic = 'force-dynamic'

/**
 * The screen that opens at eight in the morning.
 *
 * It answers "what should I do now?" — not "what do we own?". The dashboard it
 * replaces had four metric tiles, four action tiles, an attention queue, a
 * stock-health panel, a flow chart, capital by location, recent sales, oldest
 * stock and recent activity: ten regions, none of which told anybody what to
 * do next. (Audit C-2.)
 *
 * Ten regions become two tiles and a list. Everything removed still exists in
 * Insights and Stock, where it is looked at deliberately rather than skimmed
 * daily and slowly stopped being read at all.
 *
 * The ordering is role-aware in the only way that matters: whoever you are,
 * the agenda comes first if there is anything in it. A sales person's day is
 * made of follow-ups; an owner's day is made of follow-ups plus two numbers.
 * Both get the same screen, and the numbers sit under the work rather than in
 * front of it.
 */
export default async function TodayPage() {
  const user = await requireUser()

  const [agenda, waiting, notices, pipeline, stock, quiet, rates, preferences] =
    await Promise.all([
      can(user.role, 'task:read')
        ? agendaFor(user.id)
        : Promise.resolve({ overdue: [], today: [], undated: [] }),
      can(user.role, 'deal:read') ? waitingOnThem() : Promise.resolve([]),
      worthKnowing(),
      can(user.role, 'deal:read') ? pipelineSnapshot() : Promise.resolve(null),
      can(user.role, 'watch:read') ? stockSnapshot() : Promise.resolve(null),
      quietDaySummary(),
      getRateTable(),
      getPreferencesFor(user.id),
    ])

  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : BASE_CURRENCY
  const money = (base: number | null) => formatBase(base, currency, rates)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user.name.split(' ')[0] ?? user.name

  return (
    <>
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={new Date().toLocaleDateString('en-GB', {
          weekday: 'long', day: 'numeric', month: 'long',
        })}
      />

      <Agenda
        overdue={agenda.overdue}
        today={agenda.today}
        undated={agenda.undated}
        waiting={waiting.map((item) => ({
          id: item.id,
          title: item.title,
          who: item.who,
          since: item.since.toISOString(),
          amount: item.amountGbp === null ? null : money(item.amountGbp),
          href: item.href,
        }))}
        quiet={quiet}
      />

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4">
          {pipeline && (
            <Tile
              label="Pipeline"
              value={money(pipeline.openValueGbp)}
              supporting={`${money(pipeline.weightedGbp)} weighted · ${pipeline.openCount} open`}
              footnote={pipeline.closingThisWeek > 0
                ? `${pipeline.closingThisWeek} expected to close this week`
                : 'Nothing expected to close this week'}
              href="/pipeline"
            >
              <StageBars stages={pipeline.byStage} />
            </Tile>
          )}

          {stock && (
            <Tile
              label="Stock"
              value={`${stock.held} held`}
              supporting={`${money(stock.capitalGbp)} of capital`}
              footnote={stock.unpriced > 0
                ? `${stock.unpriced} unpriced · ${stock.ageing} over 90 days`
                : `${stock.ageing} over 90 days`}
              href="/inventory"
            />
          )}
        </div>

        <div className="lg:col-span-2">
          <WorthKnowing notices={notices} />
        </div>
      </div>
    </>
  )
}

function Tile({ label, value, supporting, footnote, href, children }: {
  label: string
  value: string
  supporting: string
  footnote: string
  href: string
  children?: React.ReactNode
}) {
  return (
    <Card as="section">
      <CardBody className="flex flex-col gap-1">
        <p className="text-micro font-semibold uppercase tracking-wide text-content-secondary">
          {label}
        </p>
        <p className="text-h2 font-extrabold tabular-nums text-content-primary">{value}</p>
        <p className="text-small text-content-secondary">{supporting}</p>
        {children}
        <Link
          href={href}
          className="mt-1 inline-flex items-center gap-1 text-caption font-semibold text-content-accent hover:underline"
        >
          {footnote}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </CardBody>
    </Card>
  )
}

/**
 * Distribution across stages, not across time.
 *
 * A time series here would be a forecast, and a forecast on the screen people
 * open before they have had coffee is a forecast nobody reads carefully. The
 * shape of the pipeline — where the money is bunched — is a glance-sized fact.
 * Bars carry a label as well as a height, because a bar chart with no labels
 * is decoration.
 */
function StageBars({ stages }: { stages: Array<{ stage: string; count: number; valueGbp: number }> }) {
  if (stages.length === 0) return null
  const peak = Math.max(...stages.map((row) => row.valueGbp), 1)

  return (
    <div className="mt-2 flex items-end gap-1" role="img"
      aria-label={stages.map((row) =>
        `${DEAL_STAGE_LABELS[row.stage as DealStage]}: ${row.count}`).join(', ')}>
      {stages.map((row) => (
        <div key={row.stage} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-xs bg-chart-1"
            style={{ height: `${Math.max(4, Math.round((row.valueGbp / peak) * 32))}px` }}
            title={`${DEAL_STAGE_LABELS[row.stage as DealStage]} — ${row.count}`}
          />
          <span className="w-full truncate text-center text-micro text-content-secondary">
            {row.count}
          </span>
        </div>
      ))}
    </div>
  )
}
