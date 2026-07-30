import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, isNull } from 'drizzle-orm'
import { AtSign, CalendarHeart, Globe2, Phone, ShieldAlert, Watch } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { brands, suppliers } from '@/server/db/schema'
import {
  getCustomer, getCustomerContext, sellableStockOptions, stockTheyMightWant,
  tasteProfile, timelineFor,
} from '@/server/repositories/crm-repository'
import { assignableUsers } from '@/server/services/crm-service'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader, Chip, StatCard } from '@/components/ui'
import { Timeline } from '@/components/crm/Timeline'
import { CustomerFormPanel } from '@/components/crm/CustomerFormPanel'
import { DealFormPanel } from '@/components/crm/DealFormPanel'
import { OfferComposer } from '@/components/crm/OfferComposer'
import { TaskComposer } from '@/components/crm/TaskComposer'
import { WantComposer } from '@/components/crm/WantComposer'
import { RelativeTime } from '@/components/ui/RelativeTime'
import { formatBase, isCurrency } from '@/lib/currency'
import { formatDate } from '@/lib/dates'
import {
  BASE_CURRENCY, CONTACT_CHANNEL_LABELS, CUSTOMER_STATUS_LABELS, CUSTOMER_TIER_LABELS,
  CUSTOMER_TYPE_LABELS, PAYMENT_TERMS_LABELS, type CustomerType, type PaymentTerms,
  DEAL_STAGE_LABELS, LEAD_SOURCE_LABELS, OFFER_STATUS_LABELS, REQUEST_STATUS_LABELS, type ContactChannel,
  type CustomerStatus, type CustomerTier, type DealStage, type LeadSource, type OfferStatus,
  type RequestStatus,
} from '@/lib/enums'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const row = await getCustomer(params.id)
  return { title: row ? `${row.customer.firstName} ${row.customer.lastName}` : 'Customer' }
}

/**
 * One customer, whole.
 *
 * The layout answers the three questions asked in order when the phone rings:
 * who is this, what have they bought, and what did we last say. Everything
 * else — addresses, consent, risk notes — sits under those.
 */
export default async function CustomerPage({ params }: { params: { id: string } }) {
  const user = await requireCapability('customer:read')
  const row = await getCustomer(params.id)
  if (!row) notFound()

  const { customer, ownerName } = row

  const [
    context, timeline, owners, brandRows, rates, preferences, taste, suggested,
    supplierRows, sellable,
  ] = await Promise.all([
    getCustomerContext(customer.id),
    timelineFor({ customerId: customer.id }, 40),
    assignableUsers(),
    db.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name)),
    getRateTable(),
    getPreferencesFor(user.id),
    tasteProfile(customer.id),
    stockTheyMightWant(customer.id),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)
      .where(isNull(suppliers.deletedAt)).orderBy(asc(suppliers.name)),
    sellableStockOptions(),
  ])

  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : BASE_CURRENCY
  const money = (base: number | null) => formatBase(base, currency, rates)

  const lifetime = context.purchases.reduce((sum, purchase) => sum + purchase.amountGbp, 0)
  const profit = context.purchases.reduce((sum, purchase) => sum + purchase.profitGbp, 0)
  const openValue = context.openDeals
    .filter((deal) => deal.stage !== 'WON' && deal.stage !== 'LOST')
    .reduce((sum, deal) => sum + (deal.valueGbp ?? 0), 0)

  const tierTone = customer.tier === 'VIP' ? 'gold' : customer.tier === 'PRIORITY' ? 'accent' : 'neutral'

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Customers', href: '/customers' }, { label: customer.reference }]}
        title={`${customer.firstName} ${customer.lastName}`}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {customer.company && <span>{customer.company}</span>}
            {customer.phone && (
              <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-1.5 hover:text-content-primary hover:underline">
                <Phone className="h-3.5 w-3.5" aria-hidden />{customer.phone}
              </a>
            )}
            {customer.email && (
              <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1.5 hover:text-content-primary hover:underline">
                <AtSign className="h-3.5 w-3.5" aria-hidden />{customer.email}
              </a>
            )}
            {customer.country && (
              <span className="inline-flex items-center gap-1.5">
                <Globe2 className="h-3.5 w-3.5" aria-hidden />{customer.country}
              </span>
            )}
          </span>
        }
        actions={can(user.role, 'customer:update') ? (
          <CustomerFormPanel
            owners={owners}
            brands={brandRows}
            suppliers={supplierRows}
            triggerLabel="Edit"
            variant="secondary"
            customer={{
              id: customer.id,
              firstName: customer.firstName,
              lastName: customer.lastName,
              company: customer.company,
              email: customer.email,
              phone: customer.phone,
              altPhone: customer.altPhone,
              country: customer.country,
              city: customer.city,
              addressLine1: customer.addressLine1,
              addressLine2: customer.addressLine2,
              postcode: customer.postcode,
              preferredChannel: customer.preferredChannel,
              tier: customer.tier,
              customerType: customer.customerType,
              status: customer.status,
              paymentTerms: customer.paymentTerms,
              creditLimitGbp: customer.creditLimitGbp,
              vatNo: customer.vatNo,
              registrationNo: customer.registrationNo,
              supplierId: customer.supplierId,
              leadSource: customer.leadSource,
              budgetMinGbp: customer.budgetMinGbp,
              budgetMaxGbp: customer.budgetMaxGbp,
              birthday: customer.birthday,
              notes: customer.notes,
              riskNotes: customer.riskNotes,
              marketingConsent: customer.marketingConsent,
              ownerId: customer.ownerId,
              brandIds: context.favouriteBrands.map((brand) => brand.id),
            }}
          />
        ) : undefined}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {/* Leads the chips: which side of the business they are on changes how
            every other fact about them should be read. */}
        <Chip tone={customer.customerType === 'TRADE' ? 'navy' : 'accent'}>
          {CUSTOMER_TYPE_LABELS[customer.customerType as CustomerType]}
        </Chip>
        <Chip tone={tierTone}>{CUSTOMER_TIER_LABELS[customer.tier as CustomerTier]}</Chip>
        {customer.status !== 'ACTIVE' && (
          <Chip tone="danger">{CUSTOMER_STATUS_LABELS[customer.status as CustomerStatus]}</Chip>
        )}
        {/* Not lowercased: "prefers whatsapp" is a misspelling of a brand. */}
        <Chip tone="neutral">Prefers {CONTACT_CHANNEL_LABELS[customer.preferredChannel as ContactChannel]}</Chip>
        <Chip tone="neutral">{LEAD_SOURCE_LABELS[customer.leadSource as LeadSource]}</Chip>
        {ownerName && <Chip tone="neutral">Looked after by {ownerName}</Chip>}
        {customer.marketingConsent && <Chip tone="accent">Marketing opted in</Chip>}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Watches bought" value={context.purchases.length}
          caption={context.purchases.length === 0 ? 'Nothing yet' : `Last on ${formatDate(context.purchases[0]!.saleDate)}`} />
        <StatCard label="Lifetime spend" value={money(lifetime)} tone="default"
          caption={`${money(profit)} profit to us`} />
        <StatCard label="Open pipeline" value={money(openValue)} tone="accent"
          caption={`${context.openDeals.filter((d) => d.stage !== 'WON' && d.stage !== 'LOST').length} live deals`} />
        <StatCard
          label="Last contact"
          value={customer.lastContactedAt
            ? <RelativeTime value={customer.lastContactedAt.toISOString()} />
            : 'Never'}
          tone={!customer.lastContactedAt || Date.now() - customer.lastContactedAt.getTime() > 90 * 86_400_000
            ? 'danger' : 'default'}
          caption={customer.birthday ? `Birthday ${formatDate(customer.birthday)}` : undefined}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card as="section">
            <CardHeader title="History" description="Every call, message and note, newest first." />
            <Timeline
              items={timeline}
              scope={{ customerId: customer.id }}
              canLog={can(user.role, 'activity:create')}
            />
          </Card>

          <Card as="section">
            <CardHeader
              title="Watches bought"
              description={context.purchases.length === 0
                ? 'Nothing recorded against this customer yet.'
                : 'Every watch that has left with them.'}
            />
            {context.purchases.length === 0 ? (
              <CardBody className="text-small text-content-secondary">
                When you record a sale, choose this customer and it will appear here with the margin.
              </CardBody>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {context.purchases.map((purchase) => (
                  <li key={purchase.saleId}>
                    <Link href={`/inventory/${purchase.watchId}`} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-surface-subtle">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-content-secondary" aria-hidden>
                        <Watch className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-small font-bold text-content-primary">
                          {purchase.brandName} {purchase.model}
                        </span>
                        <span className="block truncate text-caption text-content-secondary">
                          Stock {purchase.stockNo} · {purchase.invoiceNo} · {formatDate(purchase.saleDate)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-small font-bold tabular-nums text-content-primary">
                          {money(purchase.amountGbp)}
                        </span>
                        <span className="block text-caption text-content-secondary">
                          {purchase.paymentStatus === 'PAID' ? 'Paid' : purchase.paymentStatus.toLowerCase()}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card as="section">
            <CardHeader
              title="Open deals"
              action={can(user.role, 'deal:create') ? (
                <DealFormPanel
                  customers={[{ id: customer.id, name: `${customer.firstName} ${customer.lastName}` }]}
                  stock={sellable}
                  owners={owners}
                  presetCustomerId={customer.id}
                  triggerLabel="Open a deal"
                />
              ) : undefined}
            />
            {context.openDeals.length === 0 ? (
              <CardBody className="text-small text-content-secondary">Nothing in the pipeline for them.</CardBody>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {context.openDeals.map((deal) => (
                  <li key={deal.id} className="px-6 py-3.5">
                    <Link href={`/deals?deal=${deal.id}`} className="block">
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0 text-small font-bold text-content-primary hover:underline">
                          {deal.title}
                        </span>
                        <span className="shrink-0 text-small font-bold tabular-nums text-content-primary">
                          {money(deal.valueGbp)}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <Chip tone={deal.stage === 'WON' ? 'success' : deal.stage === 'LOST' ? 'danger' : 'accent'}>
                          {DEAL_STAGE_LABELS[deal.stage as DealStage]}
                        </Chip>
                        {deal.expectedClose && (
                          <span className="text-caption text-content-secondary">
                            closes {formatDate(deal.expectedClose)}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card as="section">
            <CardHeader
              title="Wanted"
              description="What they are waiting for us to find."
              action={
                <WantComposer
                  can={can(user.role, 'request:create')}
                  customerId={customer.id}
                  brands={brandRows}
                  owners={owners}
                />
              }
            />
            {context.requests.length === 0 ? (
              <CardBody className="text-small text-content-secondary">
                Nothing registered. Adding one means the system tells you when a match arrives.
              </CardBody>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {context.requests.map((request) => (
                  <li key={request.id} className="px-6 py-3.5">
                    <p className="text-small font-bold text-content-primary">
                      {[request.brandName, request.model].filter(Boolean).join(' ') || 'Any watch'}
                    </p>
                    <p className="mt-0.5 text-caption text-content-secondary">
                      {request.referenceNo ? `${request.referenceNo} · ` : ''}
                      {request.budgetGbp ? `up to ${money(request.budgetGbp)}` : 'no budget set'}
                    </p>
                    <span className="mt-1.5 inline-flex">
                      <Chip tone={request.status === 'MATCHED' ? 'success' : 'neutral'}>
                        {REQUEST_STATUS_LABELS[request.status as RequestStatus]}
                      </Chip>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card as="section">
            <CardHeader title="Follow-ups" />
            {context.openTasks.length === 0 ? (
              <CardBody className="text-small text-content-secondary">Nothing outstanding.</CardBody>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {context.openTasks.map((task) => {
                  const overdue = task.dueAt !== null && task.dueAt.getTime() < Date.now()
                  return (
                    <li key={task.id} className="flex items-start gap-3 px-6 py-3.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-small text-content-primary">{task.title}</span>
                        <span className={`block text-caption ${overdue ? 'text-state-danger' : 'text-content-secondary'}`}>
                          {task.dueAt ? <>due <RelativeTime value={task.dueAt.toISOString()} /></> : 'no date'}
                          {task.assigneeName ? ` · ${task.assigneeName}` : ''}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            <TaskComposer
              can={can(user.role, 'task:create')}
              assignees={owners}
              scope={{ customerId: customer.id }}
            />
          </Card>

          {/* An offer is the thing that turns a conversation into a deal, and
              until now it could only be recorded by the server. Scoped to the
              customer rather than a deal: most offers are made before anybody
              has opened one. */}
          <Card as="section">
            <CardHeader
              title="Offers"
              description="What we have put to them, and what it was worth."
            />
            {context.recentOffers.length === 0 ? (
              <CardBody className="text-small text-content-secondary">
                Nothing offered yet.
              </CardBody>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {context.recentOffers.map((offer) => (
                  <li key={offer.id} className="flex items-start justify-between gap-3 px-6 py-3.5">
                    <span className="min-w-0">
                      <span className="block truncate text-small text-content-primary">
                        {offer.stockNo
                          ? `${offer.brandName ?? ''} ${offer.model ?? ''}`.trim() || `Stock ${offer.stockNo}`
                          : 'No watch named'}
                      </span>
                      <span className="block text-caption text-content-secondary">
                        {OFFER_STATUS_LABELS[offer.status as OfferStatus]}
                        {offer.validUntil ? ` · good until ${formatDate(offer.validUntil)}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-small font-bold tabular-nums text-content-primary">
                      {money(offer.amountGbp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <OfferComposer
              can={can(user.role, 'deal:update')}
              scope={{ customerId: customer.id }}
            />
          </Card>

          {/* What the ledger says they want, as opposed to what they told us.
              Declared preferences go stale; purchases do not. */}
          {taste.purchases > 0 && (
            <Card as="section">
              <CardHeader title="What they buy" description="Read from what they have actually bought." />
              <CardBody className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {taste.brands.map((brand) => (
                    <Chip key={brand.brandId} tone="neutral">
                      {brand.brandName} × {brand.bought}
                    </Chip>
                  ))}
                </div>
                <dl className="grid grid-cols-2 gap-3 text-caption">
                  <div>
                    <dt className="text-content-secondary">Typical spend</dt>
                    <dd className="font-bold tabular-nums text-content-primary">{money(taste.avgGbp)}</dd>
                  </div>
                  <div>
                    <dt className="text-content-secondary">Range</dt>
                    <dd className="font-bold tabular-nums text-content-primary">
                      {money(taste.minGbp)} – {money(taste.maxGbp)}
                    </dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          )}

          {suggested.length > 0 && (
            <Card as="section">
              <CardHeader
                title="In stock for them"
                description="Matched on the brands and price band they buy in."
              />
              <ul className="divide-y divide-line-subtle">
                {suggested.map((watch) => (
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
            </Card>
          )}

          {(customer.notes || customer.riskNotes || context.favouriteBrands.length > 0) && (
            <Card as="section">
              <CardHeader title="What we know" />
              <CardBody className="flex flex-col gap-4">
                {context.favouriteBrands.length > 0 && (
                  <div>
                    <p className="text-caption font-semibold text-content-secondary">Brands they buy</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {context.favouriteBrands.map((brand) => (
                        <Chip key={brand.id} tone="neutral">{brand.name}</Chip>
                      ))}
                    </div>
                  </div>
                )}
                {customer.customerType === 'TRADE' ? (
                  <div>
                    <p className="text-caption font-semibold text-content-secondary">Terms</p>
                    <p className="mt-0.5 text-small text-content-primary">
                      {PAYMENT_TERMS_LABELS[customer.paymentTerms as PaymentTerms]}
                      {customer.creditLimitGbp ? ` · ${money(customer.creditLimitGbp)} limit` : ''}
                    </p>
                    {(customer.vatNo || customer.registrationNo) && (
                      <p className="mt-0.5 text-caption text-content-secondary">
                        {[customer.registrationNo && `Co. ${customer.registrationNo}`,
                          customer.vatNo && `VAT ${customer.vatNo}`].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                ) : (customer.budgetMinGbp || customer.budgetMaxGbp) ? (
                  <div>
                    <p className="text-caption font-semibold text-content-secondary">Budget</p>
                    <p className="mt-0.5 text-small text-content-primary">
                      {money(customer.budgetMinGbp)} – {money(customer.budgetMaxGbp)}
                    </p>
                  </div>
                ) : null}
                {customer.notes && (
                  <div>
                    <p className="text-caption font-semibold text-content-secondary">Notes</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-small text-content-primary">{customer.notes}</p>
                  </div>
                )}
                {customer.riskNotes && (
                  <div>
                    <p className="flex items-center gap-1.5 text-caption font-semibold text-state-danger">
                      <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                      Be careful about
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-small text-content-primary">{customer.riskNotes}</p>
                  </div>
                )}
                {customer.birthday && (
                  <div>
                    <p className="flex items-center gap-1.5 text-caption font-semibold text-content-secondary">
                      <CalendarHeart className="h-3.5 w-3.5" aria-hidden />
                      Birthday
                    </p>
                    <p className="mt-0.5 text-small text-content-primary">{formatDate(customer.birthday)}</p>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {context.recentOffers.length > 0 && (
            <Card as="section">
              <CardHeader title="Offers made" />
              <ul className="divide-y divide-line-subtle">
                {context.recentOffers.map((offer) => (
                  <li key={offer.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <span className="min-w-0">
                      <span className="block truncate text-small text-content-primary">
                        {offer.model ? `${offer.model}` : 'Offer'}
                      </span>
                      <span className="block text-caption text-content-secondary">
                        {offer.stockNo ? `Stock ${offer.stockNo} · ` : ''}
                        <RelativeTime value={offer.createdAt.toISOString()} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-small font-bold tabular-nums text-content-primary">
                        {money(offer.amountGbp)}
                      </span>
                      <Chip tone={offer.status === 'ACCEPTED' ? 'success' : offer.status === 'DECLINED' ? 'danger' : 'neutral'}>
                        {OFFER_STATUS_LABELS[offer.status as OfferStatus]}
                      </Chip>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <p className="mt-8">
        <Link href="/customers" className="text-small font-bold text-content-accent hover:underline">
          ← Back to customers
        </Link>
      </p>
    </>
  )
}
