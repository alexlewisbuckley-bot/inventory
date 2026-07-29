import type { Metadata } from 'next'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { findRequests } from '@/server/repositories/crm-repository'
import { matchesForRequest } from '@/server/services/crm-service'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardHeader, Chip, EmptyState, StatCard } from '@/components/ui'
import { RelativeTime } from '@/components/ui/RelativeTime'
import { formatBase, isCurrency } from '@/lib/currency'
import { formatDate } from '@/lib/dates'
import {
  BASE_CURRENCY, PRIORITY_LABELS, REQUEST_STATUS_LABELS,
  type Priority, type RequestStatus,
} from '@/lib/enums'

export const metadata: Metadata = { title: 'Wanted' }
export const dynamic = 'force-dynamic'

const PRIORITY_TONE: Record<string, 'danger' | 'gold' | 'neutral'> = {
  URGENT: 'danger',
  HIGH: 'gold',
  NORMAL: 'neutral',
  LOW: 'neutral',
}

/**
 * Demand you do not yet hold.
 *
 * The sourcing board. Every open request is shown with what we already have
 * that might satisfy it — because the most expensive mistake in this business
 * is telling somebody you will look for a watch that is sitting in the safe.
 */
export default async function RequestsPage() {
  const user = await requireCapability('request:read')

  const [requests, rates, preferences] = await Promise.all([
    findRequests({ status: ['OPEN', 'SOURCING', 'MATCHED'] }),
    getRateTable(),
    getPreferencesFor(user.id),
  ])

  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : BASE_CURRENCY
  const money = (base: number | null) => formatBase(base, currency, rates)

  const matches = await Promise.all(requests.map((request) => matchesForRequest(request.id)))
  const withMatches = requests.map((request, index) => ({ request, matches: matches[index] ?? [] }))

  const totalBudget = requests.reduce((sum, request) => sum + (request.budgetGbp ?? 0), 0)
  const matchable = withMatches.filter((row) => row.matches.length > 0).length

  return (
    <>
      <PageHeader
        title="Wanted"
        description="What customers are waiting for, and what we already hold that might do."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Open requests" value={requests.length} caption="Across every customer" />
        <StatCard label="Demand on the books" value={money(totalBudget)}
          caption="Budgets of everything outstanding" />
        <StatCard label="Already matchable" value={matchable} tone={matchable > 0 ? 'accent' : 'default'}
          caption={matchable > 0 ? 'Stock on hand fits these' : 'Nothing in stock fits'} />
      </div>

      {requests.length === 0 ? (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="Nothing on the wanted list"
          description="Register what a customer is looking for and you will be told the moment something matching is booked in."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {withMatches.map(({ request, matches: found }) => (
            <Card key={request.id} as="section">
              <CardHeader
                title={[request.brandName, request.model].filter(Boolean).join(' ') || 'Any watch'}
                description={
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link href={`/customers/${request.customerId}`} className="font-bold text-content-accent hover:underline">
                      {request.customerName}
                    </Link>
                    <span>·</span>
                    <span>asked <RelativeTime value={request.createdAt.toISOString()} /></span>
                  </span>
                }
              />

              <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
                <Chip tone={PRIORITY_TONE[request.priority] ?? 'neutral'}>
                  {PRIORITY_LABELS[request.priority as Priority]}
                </Chip>
                <Chip tone={request.status === 'MATCHED' ? 'success' : 'neutral'}>
                  {REQUEST_STATUS_LABELS[request.status as RequestStatus]}
                </Chip>
                {request.referenceNo && <Chip tone="neutral">{request.referenceNo}</Chip>}
                {request.dial && <Chip tone="neutral">{request.dial}</Chip>}
                {request.budgetGbp && (
                  <span className="text-caption tabular-nums text-content-secondary">
                    up to {money(request.budgetGbp)}
                  </span>
                )}
                {request.targetDate && (
                  <span className="text-caption text-content-secondary">
                    wanted by {formatDate(request.targetDate)}
                  </span>
                )}
              </div>

              <div className="border-t border-line-subtle">
                <p className="px-6 pt-3 text-caption font-semibold text-content-secondary">
                  {found.length === 0
                    ? 'Nothing in stock fits this yet'
                    : `${found.length} in stock could fit`}
                </p>
                {found.length > 0 && (
                  <ul className="divide-y divide-line-subtle pt-1">
                    {found.map((watch) => (
                      <li key={watch.id}>
                        <Link
                          href={`/inventory/${watch.id}`}
                          className="flex items-center justify-between gap-3 px-6 py-3 transition-colors hover:bg-surface-subtle"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-small font-bold text-content-primary">
                              {watch.brandName} {watch.model}
                            </span>
                            <span className="block text-caption text-content-secondary">
                              Stock {watch.stockNo} · {watch.condition.toLowerCase()}
                            </span>
                          </span>
                          <span className="shrink-0 text-small font-bold tabular-nums text-content-primary">
                            {money(watch.estSaleGbp)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {found.length === 0 && (
                  <p className="px-6 pb-4 pt-1 text-caption text-content-secondary">
                    {request.enquiries > 0
                      ? `${request.enquiries} supplier ${request.enquiries === 1 ? 'enquiry' : 'enquiries'} out.`
                      : 'No supplier has been asked yet.'}
                  </p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
