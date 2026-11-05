import type { Metadata } from 'next'
import { asc, isNull } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { locations, owners } from '@/server/db/schema'
import { listStockChecks, unownedStockCount } from '@/server/services/stock-check-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { StockCheckList } from '@/components/stock/StockCheckList'
import { can } from '@/lib/permissions'
import type { StockCheckStatus } from '@/lib/enums'

export const metadata: Metadata = { title: 'Stock checks' }
export const dynamic = 'force-dynamic'

export default async function StockChecksPage() {
  const user = await requireCapability('watch:read')

  const [checks, locationOptions, ownerOptions, unowned] = await Promise.all([
    listStockChecks(),
    db.select({ id: locations.id, name: locations.name }).from(locations)
      .where(isNull(locations.deletedAt)).orderBy(asc(locations.sortOrder)),
    // Every owner still on the books, inactive ones included. Inactive is a
    // statement about the relationship, not about the watches: an owner
    // being wound down can still have stock sitting in the safe, and that
    // stock is exactly what somebody needs to be able to go and count.
    db.select({ id: owners.id, name: owners.name }).from(owners)
      .where(isNull(owners.deletedAt)).orderBy(asc(owners.sortOrder)),
    unownedStockCount(),
  ])

  return (
    <>
      <PageHeader
        title="Stock checks"
        description="Counting what you actually hold, and accounting for anything you do not."
      />
      <StockCheckList
        checks={checks.map((check) => ({
          ...check,
          status: check.status as StockCheckStatus,
          countedSoFar: Number(check.countedSoFar),
          startedAt: check.startedAt.toISOString(),
        }))}
        locations={locationOptions}
        owners={ownerOptions}
        unowned={unowned}
        canCount={can(user.role, 'watch:move')}
      />
    </>
  )
}
