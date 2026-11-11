import type { Metadata } from 'next'
import Link from 'next/link'
import { requireCapability } from '@/server/auth/session'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui'
import { KeyCheck } from '@/components/settings/AiSpend'
import { anthropicConfigured } from '@/lib/anthropic-key'
import { formatMicros } from '@/lib/ai-pricing'
import { formatDate } from '@/lib/dates'
import {
  AI_FEATURE_LABELS, configuredBudgetUsd, monthStart, recentCalls, spendSince,
  type AiFeature,
} from '@/server/services/ai-usage'

export const metadata: Metadata = { title: 'AI and what it costs' }
export const dynamic = 'force-dynamic'

/**
 * What the AI costs, who spent it, and whether it still works.
 *
 * Alex: "5 cent per watch is fine but why does the claude API keep going off
 * and how do i retain it in the system to work for AI based work and check
 * and manage the costs."
 *
 * Three questions and this page is all three. The spending was only ever in
 * a log; the key only ever announced itself by failing in the middle of
 * somebody's work; and there was no ceiling at all.
 */
export default async function AiSettingsPage() {
  await requireCapability('settings:manage')

  const month = monthStart()
  const [thisMonth, budgetUsd, recent] = await Promise.all([
    spendSince(month),
    configuredBudgetUsd(),
    recentCalls(10),
  ])

  const spentUsd = thisMonth.costMicros / 1_000_000
  const overBudget = budgetUsd !== null && spentUsd >= budgetUsd

  return (
    <>
      <PageHeader
        title="AI and what it costs"
        description="Reading invoices, photographs and screenshots. What it has cost this month, and whether it still works."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'AI' }]}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Spent this month"
          value={formatMicros(thisMonth.costMicros)}
          caption={`Since ${formatDate(month)}`}
        />
        <StatCard
          label="Readings"
          value={thisMonth.calls}
          caption={thisMonth.failures > 0
            ? `${thisMonth.failures} of them failed`
            : 'none of them failed'}
        />
        <StatCard
          label="Monthly ceiling"
          value={budgetUsd === null ? 'None' : `$${budgetUsd.toFixed(2)}`}
          caption={budgetUsd === null
            ? 'Set one in Settings'
            : overBudget ? 'Reached — readings are paused' : 'Readings stop when it is reached'}
        />
      </div>

      {/* Said plainly rather than left to be worked out from two figures. */}
      {overBudget && (
        <Card className="mt-4 border-state-warning/40 bg-state-warning/5">
          <CardBody>
            <p className="text-small text-content-primary">
              <span className="font-semibold">This month&rsquo;s ceiling is reached. </span>
              Reading invoices and photographs is paused until the first of next month. Raise or clear the
              ceiling in{' '}
              <Link href="/settings" className="font-bold text-content-accent hover:underline">Settings</Link>
              {' '}to start it again now.
            </p>
          </CardBody>
        </Card>
      )}

      {thisMonth.unpriced && (
        <Card className="mt-4 border-state-warning/40 bg-state-warning/5">
          <CardBody>
            <p className="text-small text-content-primary">
              Some readings used a model with no published price in this system, so the total above is lower
              than the real bill. The price table is in <code>src/lib/ai-pricing.ts</code>.
            </p>
          </CardBody>
        </Card>
      )}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Where it went" description="This month, dearest first." />
          <CardBody>
            {thisMonth.byFeature.length === 0 ? (
              <p className="text-small text-content-secondary">
                Nothing yet this month.
              </p>
            ) : (
              <dl className="flex flex-col">
                {thisMonth.byFeature.map((row) => (
                  <div
                    key={row.feature}
                    className="flex items-baseline justify-between gap-4 border-b border-line-subtle py-2.5 last:border-0"
                  >
                    <dt className="text-small text-content-secondary">
                      {AI_FEATURE_LABELS[row.feature as AiFeature] ?? row.feature}
                      <span className="block text-micro text-content-muted">
                        {row.calls} {row.calls === 1 ? 'reading' : 'readings'}
                        {row.failures > 0 && ` · ${row.failures} failed`}
                      </span>
                    </dt>
                    <dd className="text-small font-bold tabular-nums text-content-primary">
                      {formatMicros(row.costMicros)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </CardBody>
        </Card>

        <KeyCheck configured={anthropicConfigured()} />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="The last few readings"
          description="A run of failures here is what a lapsed key looks like from the outside."
        />
        <CardBody>
          {recent.length === 0 ? (
            <p className="text-small text-content-secondary">Nothing has been read yet.</p>
          ) : (
            <ul className="flex flex-col">
              {recent.map((call) => (
                <li
                  key={call.id}
                  className="flex items-baseline justify-between gap-4 border-b border-line-subtle py-2.5 last:border-0"
                >
                  <span className="text-small text-content-secondary">
                    {AI_FEATURE_LABELS[call.feature as AiFeature] ?? call.feature}
                    {!call.ok && call.error && (
                      <span className="block text-micro text-state-danger">{call.error}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-small tabular-nums text-content-muted">
                    {call.ok ? formatMicros(call.costMicros ?? 0) : 'failed'}
                    <span className="block text-micro">{formatDate(call.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  )
}
