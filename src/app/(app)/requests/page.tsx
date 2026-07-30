import type { Metadata } from 'next'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { asc, isNull } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { brands, suppliers } from '@/server/db/schema'
import { customerOptions, enquiriesFor, findRequests } from '@/server/repositories/crm-repository'
import { assignableUsers, matchesForRequest } from '@/server/services/crm-service'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardHeader, Chip, EmptyState, StatCard } from '@/components/ui'
import { RelativeTime } from '@/components/ui/RelativeTime'
import { EnquiryComposer } from '@/components/crm/EnquiryComposer'
import { RequestStatusControl } from '@/components/crm/RequestStatusControl'
import { TaskComposer } from '@/components/crm/TaskComposer'
import { WantComposer } from '@/components/crm/WantComposer'
import { can } from '@/lib/permissions'
import { formatBase, isCurrency } from '@/lib/currency'
import { formatDate } from '@/lib/dates'
import {
  BASE_CURRENCY, PRIORITY_LABELS, REQUEST_ENQUIRY_STATUS_LABELS,
  type Priority, type RequestEnquiryStatus, type RequestStatus,
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

  const [requests, rates, preferences, customers, brandRows, supplierRows, owners] =
    await Promise.all([
      findRequests({ status: ['OPEN', 'SOURCING', 'MATCHED'] }),
      getRateTable(),
      getPreferencesFor(user.id),
      customerOptions(),
      db.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name)),
      db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)
        .where(isNull(suppliers.deletedAt)).orderBy(asc(suppliers.name)),
      assignableUsers(),
    ])

  const canCreate = can(user.role, 'request:create')
  const canUpdate = can(user.role, 'request:update')
  const canTask = can(user.role, 'task:create')
  const canBookIn = can(user.role, 'watch:create')

  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : BASE_CURRENCY
  const money = (base: number | null) => formatBase(base, currency, rates)

  const [matches, enquiryLists] = await Promise.all([
    Promise.all(requests.map((request) => matchesForRequest(request.id))),
    Promise.all(requests.map((request) => enquiriesFor(request.id))),
  ])
  const withMatches = requests.map((request, index) => ({
    request,
    matches: matches[index] ?? [],
    enquiries: enquiryLists[index] ?? [],
  }))

  const totalBudget = requests.reduce((sum, request) => sum + (request.budgetGbp ?? 0), 0)
  const matchable = withMatches.filter((row) => row.matches.length > 0).length

  return (
    <>
      <PageHeader
        title="Wanted"
        description="What customers are waiting for, and what we already hold that might do."
        actions={
          <WantComposer
            can={canCreate}
            customers={customers.map((c) => ({
              id: c.id, name: c.company ? `${c.name} · ${c.company}` : c.name,
            }))}
            brands={brandRows}
            owners={owners}
            label="Register a want"
          />
        }
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
          action={canCreate ? (
            <WantComposer
              can
              customers={customers.map((c) => ({
                id: c.id, name: c.company ? `${c.name} · ${c.company}` : c.name,
              }))}
              brands={brandRows}
              owners={owners}
              label="Register the first want"
            />
          ) : undefined}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {withMatches.map(({ request, matches: found, enquiries: asked }) => (
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
                <RequestStatusControl
                  id={request.id}
                  status={request.status as RequestStatus}
                  canUpdate={canUpdate}
                />
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
                {/* Who has been asked and what they said — the sourcing state
                    of the want, on the card. A quote carries the action that
                    accepts it: intake, pre-filled from the request and the
                    quote, so taking a price never means retyping it. */}
                {asked.length === 0 ? (
                  <p className="px-6 pb-4 pt-1 text-caption text-content-secondary">
                    No supplier has been asked yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-line-subtle pb-1 pt-1">
                    {asked.map((enquiry) => (
                      <li key={enquiry.id} className="flex items-center justify-between gap-3 px-6 py-2.5">
                        <span className="min-w-0">
                          <span className="block truncate text-small font-semibold text-content-primary">
                            {enquiry.supplierName ?? 'Supplier'}
                          </span>
                          <span className="block text-caption text-content-secondary">
                            {REQUEST_ENQUIRY_STATUS_LABELS[enquiry.status as RequestEnquiryStatus]}
                            {enquiry.quotedGbp !== null && ` · quoted ${money(enquiry.quotedGbp)}`}
                          </span>
                        </span>
                        {enquiry.quotedGbp !== null && canBookIn && (
                          <Link
                            href={`/inventory/new?request=${request.id}&enquiry=${enquiry.id}`}
                            className="shrink-0 text-caption font-semibold text-content-accent hover:underline"
                          >
                            Book it in →
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <EnquiryComposer
                can={canUpdate && supplierRows.length > 0}
                requestId={request.id}
                suppliers={supplierRows}
              />
              <TaskComposer
                can={canTask}
                assignees={owners}
                scope={{ customerId: request.customerId, requestId: request.id }}
                label="Add a follow-up"
              />
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
