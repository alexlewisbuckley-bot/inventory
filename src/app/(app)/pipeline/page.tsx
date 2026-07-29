import type { Metadata } from 'next'
import { asc, isNull } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { customers } from '@/server/db/schema'
import { findDeals, sellableStockOptions } from '@/server/repositories/crm-repository'
import { assignableUsers } from '@/server/services/crm-service'
import { dealQuerySchema } from '@/lib/validation'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatCard } from '@/components/ui'
import { PipelineBoard } from '@/components/crm/PipelineBoard'
import { DealFormPanel } from '@/components/crm/DealFormPanel'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { formatBase, isCurrency } from '@/lib/currency'
import { BASE_CURRENCY } from '@/lib/enums'
import { can } from '@/lib/permissions'
import { sql } from 'drizzle-orm'

export const metadata: Metadata = { title: 'Pipeline' }
export const dynamic = 'force-dynamic'

export default async function PipelinePage({ searchParams }: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const user = await requireCapability('deal:read')

  const query = dealQuerySchema.parse({
    q: searchParams.q,
    ownerId: searchParams.ownerId ? [searchParams.ownerId].flat() : undefined,
  })

  const [deals, owners, customerRows, stock, rates, preferences] = await Promise.all([
    findDeals(query),
    assignableUsers(),
    db.select({
      id: customers.id,
      name: sql<string>`trim(${customers.firstName} || ' ' || ${customers.lastName})`,
    }).from(customers).where(isNull(customers.deletedAt)).orderBy(asc(customers.lastName)),
    sellableStockOptions(),
    getRateTable(),
    getPreferencesFor(user.id),
  ])

  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : BASE_CURRENCY
  const money = (base: number | null) => formatBase(base, currency, rates)

  const open = deals.filter((deal) => deal.stage !== 'WON' && deal.stage !== 'LOST')
  const total = open.reduce((sum, deal) => sum + (deal.valueGbp ?? 0), 0)
  const weighted = open.reduce((sum, deal) => sum + ((deal.valueGbp ?? 0) * deal.probability) / 100, 0)
  const won = deals.filter((deal) => deal.stage === 'WON')
  const closed = won.length + deals.filter((deal) => deal.stage === 'LOST').length

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Every live opportunity, and what it is worth if it lands."
        actions={can(user.role, 'deal:create')
          ? <DealFormPanel customers={customerRows} stock={stock} owners={owners} />
          : undefined}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open deals" value={open.length} caption="Across every stage" />
        <StatCard label="Pipeline value" value={money(total)} caption="If every one lands" />
        <StatCard label="Weighted" value={money(Math.round(weighted))} tone="accent"
          caption="Value × likelihood, the number worth forecasting on" />
        <StatCard
          label="Win rate"
          value={closed === 0 ? '—' : `${Math.round((won.length / closed) * 100)}%`}
          caption={closed === 0 ? 'Nothing closed yet' : `${won.length} won of ${closed} closed`}
        />
      </div>

      <PipelineBoard deals={deals} owners={owners} canEdit={can(user.role, 'deal:update')} />
    </>
  )
}
