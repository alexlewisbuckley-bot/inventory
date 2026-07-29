'use client'

import Link from 'next/link'
import { Users2 } from 'lucide-react'
import { useListQuery } from '@/hooks/useListQuery'
import {
  Avatar, Card, Chip, EmptyState, LinkButton, Pagination, Table, TBody, TD, TH, THead, TR,
  ToolbarRow, ToolbarSearch, ToolbarSelect, useCurrency,
} from '@/components/ui'
import { RelativeTime } from '@/components/ui/RelativeTime'
import {
  CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS, CUSTOMER_TIERS, CUSTOMER_TIER_LABELS,
  CUSTOMER_TYPES, CUSTOMER_TYPE_LABELS, LEAD_SOURCES, LEAD_SOURCE_LABELS,
  type CustomerTier, type CustomerType,
} from '@/lib/enums'
import { cn } from '@/lib/cn'
import type { CustomerListResult } from '@/server/repositories/crm-repository'

const TIER_TONE: Record<CustomerTier, 'gold' | 'accent' | 'neutral'> = {
  VIP: 'gold',
  PRIORITY: 'accent',
  STANDARD: 'neutral',
}

/**
 * The customer book.
 *
 * Sorted by name by default, because that is how somebody looks for a person
 * they have already met. The two columns that decide who to ring — what they
 * have spent and when anybody last spoke to them — are on the row rather than
 * one click inside it.
 */
export function CustomerTable({ result, owners }: {
  result: CustomerListResult
  owners: Array<{ id: string; name: string }>
}) {
  const query = useListQuery()
  const { money } = useCurrency()

  return (
    <>
      {/* The first cut anyone makes on this list, so it is one click rather
          than a filter buried in a dropdown beside four others. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {[
          { value: '', label: 'Everyone' },
          ...CUSTOMER_TYPES.map((type) => ({ value: type, label: CUSTOMER_TYPE_LABELS[type] })),
        ].map((segment) => {
          const active = (query.get('customerType') ?? '') === segment.value
          return (
            <button
              key={segment.value || 'all'}
              type="button"
              aria-pressed={active}
              onClick={() => query.set('customerType', segment.value || null)}
              className={cn(
                'inline-flex h-9 items-center rounded-md px-3.5 text-small font-semibold transition-colors',
                active
                  ? 'bg-navy-700 text-white'
                  : 'text-content-secondary hover:bg-surface-subtle hover:text-content-primary',
              )}
            >
              {segment.label}
            </button>
          )
        })}
      </div>

      <ToolbarRow className="mb-4">
        <ToolbarSearch
          value={query.get('q') ?? ''}
          onChange={(value) => query.set('q', value || null)}
          label="Search customers"
          placeholder="Name, company, email or phone…"
          className="min-w-[260px]"
        />
        <ToolbarSelect
          label="Tier"
          value={query.get('tier') ?? ''}
          onChange={(value) => query.set('tier', value || null)}
          options={CUSTOMER_TIERS.map((t) => ({ value: t, label: CUSTOMER_TIER_LABELS[t] }))}
        />
        <ToolbarSelect
          label="Owner"
          value={query.get('ownerId') ?? ''}
          onChange={(value) => query.set('ownerId', value || null)}
          options={owners.map((o) => ({ value: o.id, label: o.name }))}
        />
        <ToolbarSelect
          label="Source"
          value={query.get('leadSource') ?? ''}
          onChange={(value) => query.set('leadSource', value || null)}
          options={LEAD_SOURCES.map((s) => ({ value: s, label: LEAD_SOURCE_LABELS[s] }))}
        />
        <ToolbarSelect
          label="Status"
          value={query.get('status') ?? ''}
          onChange={(value) => query.set('status', value || null)}
          options={CUSTOMER_STATUSES.map((s) => ({ value: s, label: CUSTOMER_STATUS_LABELS[s] }))}
        />
      </ToolbarRow>

      {result.items.length === 0 ? (
        <EmptyState
          icon={<Users2 className="h-6 w-6" />}
          title={query.activeFilterCount > 0 ? 'Nobody matches that' : 'No customers yet'}
          description={query.activeFilterCount > 0
            ? 'Try a wider search, or clear the filters to see the whole book.'
            : 'Add the people you sell to and every enquiry, offer and sale will collect against them.'}
          action={query.activeFilterCount > 0
            ? <button type="button" onClick={query.clearAll} className="text-small font-bold text-content-accent hover:underline">Clear the filters</button>
            : <LinkButton href="/customers?new=1">Add a customer</LinkButton>}
        />
      ) : (
        <Card className={`overflow-hidden ${query.isPending ? 'opacity-60' : ''} transition-opacity`}>
          {/* Cards on a phone, as everywhere else in the application. */}
          <ul className="divide-y divide-line-subtle sm:hidden">
            {result.items.map((customer) => (
              <li key={customer.id}>
                <Link href={`/customers/${customer.id}`} className="flex items-start gap-3 px-4 py-3.5">
                  <Avatar initials={initialsOf(customer)} id={customer.id} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-body font-bold text-content-primary">
                        {customer.firstName} {customer.lastName}
                      </span>
                      {customer.tier !== 'STANDARD' && (
                        <Chip tone={TIER_TONE[customer.tier as CustomerTier]}>
                          {CUSTOMER_TIER_LABELS[customer.tier as CustomerTier]}
                        </Chip>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-caption text-content-secondary">
                      {CUSTOMER_TYPE_LABELS[customer.customerType as CustomerType]}
                      {' · '}
                      {customer.company ?? customer.email ?? customer.phone ?? 'No contact details'}
                    </span>
                    <span className="mt-1.5 block text-caption text-content-secondary">
                      {customer.purchaseCount} bought · {money(customer.lifetimeValueGbp)} lifetime
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden sm:block">
            <Table>
              <THead>
                <TR>
                  <TH>Customer</TH>
                  <TH width="90px">Side</TH>
                  <TH width="190px">Contact</TH>
                  <TH width="120px">Country</TH>
                  <TH width="120px">Owner</TH>
                  <TH width="80px" align="right">Bought</TH>
                  <TH width="120px" align="right">Lifetime</TH>
                  <TH width="120px">Last contact</TH>
                  <TH width="150px" align="right">Open</TH>
                </TR>
              </THead>
              <TBody>
                {result.items.map((customer) => (
                  <TR key={customer.id}>
                    <TD>
                      <Link href={`/customers/${customer.id}`} className="flex items-center gap-3">
                        <Avatar initials={initialsOf(customer)} id={customer.id} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-bold text-content-primary hover:underline">
                              {customer.firstName} {customer.lastName}
                            </span>
                            {customer.tier !== 'STANDARD' && (
                              <Chip tone={TIER_TONE[customer.tier as CustomerTier]}>
                                {CUSTOMER_TIER_LABELS[customer.tier as CustomerTier]}
                              </Chip>
                            )}
                          </span>
                          <span className="block truncate text-caption text-content-secondary">
                            {customer.company ?? customer.reference}
                          </span>
                        </span>
                      </Link>
                    </TD>
                    <TD>
                      <Chip tone={customer.customerType === 'TRADE' ? 'navy' : 'accent'}>
                        {CUSTOMER_TYPE_LABELS[customer.customerType as CustomerType]}
                      </Chip>
                    </TD>
                    <TD className="text-content-secondary">
                      <span className="block truncate" title={customer.email ?? undefined}>
                        {customer.email ?? customer.phone ?? '—'}
                      </span>
                    </TD>
                    <TD className="text-content-secondary">
                      <span className="block truncate">{customer.country ?? '—'}</span>
                    </TD>
                    <TD className="text-content-secondary">
                      <span className="block truncate">{customer.ownerName ?? 'Unassigned'}</span>
                    </TD>
                    <TD align="right" className="tabular-nums">{customer.purchaseCount}</TD>
                    <TD align="right" className="font-bold tabular-nums">
                      {customer.lifetimeValueGbp > 0 ? money(customer.lifetimeValueGbp) : '—'}
                    </TD>
                    <TD className="text-content-secondary">
                      {customer.lastContactedAt
                        ? <RelativeTime value={customer.lastContactedAt as unknown as string} />
                        : 'Never'}
                    </TD>
                    <TD align="right">
                      <span className="flex items-center justify-end gap-1.5">
                        {customer.openDeals > 0 && <Chip tone="accent">{customer.openDeals} deal{customer.openDeals === 1 ? '' : 's'}</Chip>}
                        {customer.openRequests > 0 && <Chip tone="neutral">{customer.openRequests} wanted</Chip>}
                        {customer.openDeals === 0 && customer.openRequests === 0 && (
                          <span className="text-caption text-content-secondary">—</span>
                        )}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          <Pagination
            page={result.page}
            perPage={result.perPage}
            total={result.total}
            noun="customer"
            onPage={(page) => query.set('page', String(page))}
            onPerPage={(perPage) => query.set('perPage', String(perPage))}
          />
        </Card>
      )}
    </>
  )
}

function initialsOf(customer: { firstName: string; lastName: string }): string {
  return `${customer.firstName[0] ?? ''}${customer.lastName[0] ?? ''}`.toUpperCase()
}
