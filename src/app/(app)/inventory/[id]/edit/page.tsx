import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { asc, eq, isNull } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { appSettings, brands, locations, suppliers } from '@/server/db/schema'
import { getWatchDetail } from '@/server/services/watch-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { WatchForm } from '@/components/inventory/WatchForm'
import { toMajor } from '@/lib/money'
import { toDateInput } from '@/lib/dates'

export const metadata: Metadata = { title: 'Edit watch' }
export const dynamic = 'force-dynamic'

export default async function EditWatchPage({ params }: { params: { id: string } }) {
  await requireCapability('watch:update')
  const record = await getWatchDetail(params.id).catch(() => null)
  if (!record) notFound()

  const [brandRows, supplierRows, locationRows, fxRow] = await Promise.all([
    db.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)
      .where(isNull(suppliers.deletedAt)).orderBy(asc(suppliers.name)),
    db.select({ id: locations.id, name: locations.name }).from(locations)
      .where(isNull(locations.deletedAt)).orderBy(asc(locations.sortOrder)),
    db.select().from(appSettings).where(eq(appSettings.key, 'finance.fxGbpUsd')).limit(1),
  ])

  const { watch } = record

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Inventory', href: '/inventory' },
          { label: `Stock ${watch.stockNo}`, href: `/inventory/${watch.id}` },
          { label: 'Edit' },
        ]}
        title={`Edit stock ${watch.stockNo}`}
        description="Changes are recorded in the watch's history with your name against them."
      />
      <div className="max-w-4xl">
        <WatchForm
          mode="edit"
          brands={brandRows}
          suppliers={supplierRows}
          locations={locationRows}
          fxRate={Number(fxRow[0]?.value) || 1.33}
          initial={{
            id: watch.id,
            version: watch.version,
            brandId: watch.brandId,
            model: watch.model,
            nickname: watch.nickname ?? '',
            serial: watch.serial ?? '',
            year: watch.year ? String(watch.year) : '',
            condition: watch.condition,
            boxPapers: watch.boxPapers,
            supplierId: watch.supplierId,
            purchaseDate: toDateInput(watch.purchaseDate),
            purchasePriceGbp: String(toMajor(watch.purchasePriceGbp)),
            estSaleUsd: watch.estSaleUsd !== null ? String(toMajor(watch.estSaleUsd)) : '',
            locationId: watch.locationId,
            notes: watch.notes ?? '',
          }}
        />
      </div>
    </>
  )
}
