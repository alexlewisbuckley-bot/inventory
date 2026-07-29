import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Watch } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import {
  getDeal, getDealContext, sellableStockOptions, timelineFor,
} from '@/server/repositories/crm-repository'
import { assignableUsers } from '@/server/services/crm-service'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader, Chip } from '@/components/ui'
import { RelativeTime } from '@/components/ui/RelativeTime'
import { Timeline } from '@/components/crm/Timeline'
import { DealFacts } from '@/components/crm/DealFacts'
import { DealFormPanel } from '@/components/crm/DealFormPanel'
import { DealHeader } from '@/components/crm/DealHeader'
import { OfferComposer } from '@/components/crm/OfferComposer'
import { StageRail } from '@/components/crm/StageRail'
import { TaskComposer } from '@/components/crm/TaskComposer'
import { formatBase, isCurrency } from '@/lib/currency'
import { formatDate } from '@/lib/dates'
import {
  BASE_CURRENCY, DEAL_STAGE_LABELS, OFFER_STATUS_LABELS, TASK_KIND_LABELS,
  type DealStage, type OfferStatus, type TaskKind,
} from '@/lib/enums'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const row = await getDeal(params.id)
  return { title: row ? row.deal.title : 'Deal' }
}

/**
 * One deal, whole.
 *
 * The object the audit found with no detail view at all: cards on the board
 * linked to the customer, so the only way to see what had happened on a deal
 * was to read a customer's entire history and work out which parts belonged to
 * it. (Audit C-4.)
 *
 * Two things here exist nowhere else in the product. The stage rail reads
 * `deal_stage_events`, which has been written since the CRM shipped and
 * displayed by nothing — it turns "in Negotiation" into "in Negotiation for
 * three weeks", which is the fact that actually prompts a call. And the watch
 * panel states the margin *at this deal's current value*, which is the number
 * a negotiation is about and which was previously only visible after the sale
 * had already been recorded.
 */
export default async function DealPage({ params }: { params: { id: string } }) {
  const user = await requireCapability('deal:read')
  const row = await getDeal(params.id)
  if (!row) notFound()

  const { deal, customerName, ownerName, stockNo, watchModel, watchCostGbp } = row

  const [context, timeline, owners, stock, rates, preferences] = await Promise.all([
    getDealContext(deal.id),
    timelineFor({ dealId: deal.id }, 40),
    assignableUsers(),
    sellableStockOptions(),
    getRateTable(),
    getPreferencesFor(user.id),
  ])
  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : BASE_CURRENCY
  const money = (base: number | null) => formatBase(base, currency, rates)

  const canEdit = can(user.role, 'deal:update')
  const stage = deal.stage as DealStage

  // The margin this deal would make if it landed at the value it is at now.
  // Null rather than zero when either half is missing: a margin of £0 and a
  // margin nobody can calculate are different answers, and showing the first
  // when you mean the second invites somebody to discount into a loss.
  const margin = deal.valueGbp !== null && watchCostGbp !== null
    ? deal.valueGbp - watchCostGbp
    : null

  const editPanel = canEdit ? (
    <DealFormPanel
      customers={customerName && deal.customerId ? [{ id: deal.customerId, name: customerName }] : []}
      stock={stock}
      owners={owners}
      triggerLabel="Edit"
      variant="secondary"
      size="sm"
      deal={{
        id: deal.id,
        title: deal.title,
        customerId: deal.customerId,
        watchId: deal.watchId,
        valueGbp: deal.valueGbp,
        stage: deal.stage,
        expectedClose: deal.expectedClose,
        ownerId: deal.ownerId,
        source: deal.source,
        notes: deal.notes,
      }}
    />
  ) : undefined

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Pipeline', href: '/pipeline' }, { label: deal.reference }]}
        title={deal.title}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {customerName && deal.customerId && (
              <Link href={`/customers/${deal.customerId}`} className="font-semibold hover:text-content-primary hover:underline">
                {customerName}
              </Link>
            )}
            <span className="tabular-nums">{money(deal.valueGbp)}</span>
            <span className="tabular-nums">{deal.probability}% likely</span>
            {deal.expectedClose && <span>closes {formatDate(new Date(deal.expectedClose))}</span>}
            {ownerName && <span>{ownerName}</span>}
          </span>
        }
        actions={
          <DealHeader id={deal.id} title={deal.title} stage={stage} canEdit={canEdit} />
        }
      />

      <Card as="section" className="mb-6">
        <CardBody>
          <StageRail
            createdAt={deal.createdAt}
            events={context.events.map((event) => ({
              fromStage: event.fromStage as DealStage | null,
              toStage: event.toStage as DealStage,
              at: event.at,
            }))}
            stage={stage}
            lostReason={deal.lostReason}
          />
        </CardBody>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card as="section">
            <CardHeader
              title="What has happened"
              description="Calls, notes, offers and every stage this deal has moved through."
            />
            <Timeline
              items={timeline}
              scope={{
                dealId: deal.id,
                customerId: deal.customerId ?? undefined,
                watchId: deal.watchId ?? undefined,
              }}
              canLog={can(user.role, 'activity:create')}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card as="section">
            <CardHeader title="The watch" />
            {deal.watchId ? (
              <>
                <Link
                  href={`/inventory/${deal.watchId}`}
                  className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-surface-subtle"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-content-secondary" aria-hidden>
                    <Watch className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-small font-bold text-content-primary">
                      {watchModel ?? 'Watch'}
                    </span>
                    <span className="block text-caption text-content-secondary">
                      Stock {stockNo} · cost {money(watchCostGbp)}
                    </span>
                  </span>
                </Link>
                <CardBody className="border-t border-line-subtle">
                  <p className="text-caption font-semibold text-content-secondary">
                    Margin at {money(deal.valueGbp)}
                  </p>
                  {margin === null ? (
                    <p className="mt-1 text-small text-content-muted">
                      {deal.valueGbp === null
                        ? 'Put a value on the deal to see what it makes.'
                        : 'This watch has no cost recorded, so the margin cannot be worked out.'}
                    </p>
                  ) : (
                    <p className={`mt-1 text-h3 font-extrabold tabular-nums ${
                      margin >= 0 ? 'text-content-primary' : 'text-state-danger'
                    }`}>
                      {margin >= 0 ? '+' : '−'}{money(Math.abs(margin))}
                    </p>
                  )}
                </CardBody>
              </>
            ) : (
              <CardBody className="text-small text-content-secondary">
                No watch attached yet. Attach one and this panel shows what the deal makes at
                its current value.
              </CardBody>
            )}
          </Card>

          <Card as="section">
            <CardHeader title="Offers" description="What was put to them, and what came back." />
            {context.offers.length === 0 ? (
              <CardBody className="text-small text-content-secondary">
                Nothing offered on this deal yet.
              </CardBody>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {context.offers.map((offer) => (
                  <li key={offer.id} className="px-6 py-3.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-small font-bold tabular-nums text-content-primary">
                        {money(offer.amountGbp)}
                      </span>
                      <Chip tone={
                        offer.status === 'ACCEPTED' ? 'success'
                          : offer.status === 'DECLINED' || offer.status === 'EXPIRED' ? 'danger'
                          : 'neutral'
                      }>
                        {OFFER_STATUS_LABELS[offer.status as OfferStatus]}
                      </Chip>
                    </div>
                    <p className="mt-0.5 text-caption text-content-secondary">
                      <RelativeTime value={offer.createdAt.toISOString()} />
                      {offer.currency !== BASE_CURRENCY && ` · offered in ${offer.currency}`}
                      {offer.validUntil && ` · good until ${formatDate(new Date(offer.validUntil))}`}
                      {offer.createdByName && ` · ${offer.createdByName}`}
                    </p>
                    {offer.notes && (
                      <p className="mt-1 text-caption text-content-secondary">{offer.notes}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <OfferComposer
              can={canEdit}
              scope={{
                dealId: deal.id,
                customerId: deal.customerId ?? undefined,
                watchId: deal.watchId ?? undefined,
              }}
            />
          </Card>

          <Card as="section">
            <CardHeader title="Tasks" description="What this deal still needs somebody to do." />
            {context.tasks.length === 0 ? (
              <CardBody className="text-small text-content-secondary">
                Nothing outstanding.
              </CardBody>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {context.tasks.map((task) => {
                  const overdue = task.status === 'OPEN' && task.dueAt !== null
                    && task.dueAt.getTime() < Date.now()
                  return (
                    <li key={task.id} className="px-6 py-3.5">
                      <p className={`text-small ${
                        task.status === 'DONE'
                          ? 'text-content-secondary line-through'
                          : 'text-content-primary'
                      }`}>
                        {task.title}
                      </p>
                      <p className={`mt-0.5 text-caption ${
                        overdue ? 'font-semibold text-state-danger' : 'text-content-secondary'
                      }`}>
                        {task.dueAt ? <>due <RelativeTime value={task.dueAt.toISOString()} /></> : 'no date'}
                        {' · '}{TASK_KIND_LABELS[task.kind as TaskKind] ?? task.kind}
                        {task.assigneeName ? ` · ${task.assigneeName}` : ''}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
            <TaskComposer
              can={can(user.role, 'task:create')}
              assignees={owners}
              scope={{
                dealId: deal.id,
                customerId: deal.customerId ?? undefined,
                watchId: deal.watchId ?? undefined,
              }}
            />
          </Card>

          <DealFacts
            deal={{
              valueGbp: deal.valueGbp,
              probability: deal.probability,
              stage: deal.stage,
              expectedClose: deal.expectedClose,
              source: deal.source,
              notes: deal.notes,
              reference: `${deal.reference} · ${DEAL_STAGE_LABELS[stage]}`,
              customerId: deal.customerId,
              customerName,
            }}
            ownerName={ownerName}
            money={money}
            action={editPanel}
          />
        </div>
      </div>
    </>
  )
}
