import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { asc, isNull } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { locations } from '@/server/db/schema'
import { getStockCheck, getStockCheckLines } from '@/server/services/stock-check-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { Chip } from '@/components/ui'
import { StockCheckRunner } from '@/components/stock/StockCheckRunner'
import { can } from '@/lib/permissions'
import { formatDateTime } from '@/lib/dates'
import {
  STOCK_CHECK_STATUS_LABELS, STOCK_CHECK_STATUS_TONE,
  type StockCheckLineStatus, type StockCheckStatus,
} from '@/lib/enums'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const record = await getStockCheck(params.id).catch(() => null)
  return { title: record ? record.check.reference : 'Stock check not found' }
}

export default async function StockCheckPage({ params }: { params: { id: string } }) {
  const user = await requireCapability('watch:read')
  const record = await getStockCheck(params.id).catch(() => null)
  if (!record) notFound()

  const [lines, locationOptions] = await Promise.all([
    getStockCheckLines(params.id),
    db.select({ id: locations.id, name: locations.name }).from(locations)
      .where(isNull(locations.deletedAt)).orderBy(asc(locations.sortOrder)),
  ])

  const status = record.check.status as StockCheckStatus

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Stock checks', href: '/stock-checks' },
          { label: record.check.reference },
        ]}
        title={record.check.reference}
        description={[
          record.locationName ?? 'All stock held',
          `${record.check.expectedCount} expected`,
          `opened ${formatDateTime(record.check.startedAt)}`,
          record.startedByName ? `by ${record.startedByName}` : null,
          record.check.completedAt
            ? `closed ${formatDateTime(record.check.completedAt)}${record.completedByName ? ` by ${record.completedByName}` : ''}`
            : null,
        ].filter(Boolean).join(' · ')}
        actions={
          <Chip tone={STOCK_CHECK_STATUS_TONE[status]} dot={status === 'OPEN'}>
            {STOCK_CHECK_STATUS_LABELS[status]}
          </Chip>
        }
      />

      {record.check.notes && (
        <p className="mb-6 whitespace-pre-line text-small text-content-secondary">{record.check.notes}</p>
      )}

      <StockCheckRunner
        checkId={record.check.id}
        reference={record.check.reference}
        open={status === 'OPEN'}
        lines={lines.map((line) => ({
          id: line.id,
          watchId: line.watchId,
          status: line.status as StockCheckLineStatus,
          notes: line.notes,
          checkedByName: line.checkedByName,
          expectedLocationName: line.expectedLocationName,
          foundLocationName: line.foundLocationName,
          stockNo: line.stockNo,
          model: line.model,
          serial: line.serial,
          brandName: line.brandName,
        }))}
        locations={locationOptions}
        canCount={can(user.role, 'watch:move')}
      />
    </>
  )
}
