import type { Metadata } from 'next'
import { asc, isNull } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { locations } from '@/server/db/schema'
import { listStockChecks } from '@/server/services/stock-check-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { StockCheckList } from '@/components/stock/StockCheckList'
import { can } from '@/lib/permissions'
import type { StockCheckStatus } from '@/lib/enums'

export const metadata: Metadata = { title: 'Stock checks' }
export const dynamic = 'force-dynamic'

export default async function StockChecksPage() {
  const user = await requireCapability('watch:read')

  const [checks, locationOptions] = await Promise.all([
    listStockChecks(),
    db.select({ id: locations.id, name: locations.name }).from(locations)
      .where(isNull(locations.deletedAt)).orderBy(asc(locations.sortOrder)),
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
        canCount={can(user.role, 'watch:move')}
      />
    </>
  )
}
