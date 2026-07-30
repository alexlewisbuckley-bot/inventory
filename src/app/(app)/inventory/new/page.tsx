import type { Metadata } from 'next'
import { asc, eq, isNull } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { brands, locations, suppliers } from '@/server/db/schema'
import { PageHeader } from '@/components/layout/PageHeader'
import { WatchForm } from '@/components/inventory/WatchForm'
import { sourcingPrefill } from '@/server/services/sourcing-service'

export const metadata: Metadata = { title: 'Add a watch' }
export const dynamic = 'force-dynamic'

export default async function NewWatchPage({ searchParams }: {
  searchParams: { request?: string; enquiry?: string }
}) {
  await requireCapability('watch:create')

  // Arriving from an accepted quote on the Wanted board: the form starts from
  // the request and the quote instead of blank. A prefill is a head start,
  // not a decision — everything stays editable.
  const prefill = searchParams.request
    ? await sourcingPrefill(searchParams.request, searchParams.enquiry ?? null)
    : null

  const [brandRows, supplierRows, locationRows] = await Promise.all([
    db.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)
      .where(isNull(suppliers.deletedAt)).orderBy(asc(suppliers.name)),
    db.select({ id: locations.id, name: locations.name }).from(locations)
      .where(isNull(locations.deletedAt)).orderBy(asc(locations.sortOrder)),
  ])

  return (
    <>
      <PageHeader
        title={prefill ? `Book in for ${prefill.customerName}` : 'Add a watch'}
        description={prefill
          ? 'Started from their want and the accepted quote. Check it, complete it, and their request is marked fulfilled.'
          : 'Log a new purchase into stock. It appears in the inventory immediately.'}
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Add a watch' }]}
      />
      <div className="max-w-4xl">
        <WatchForm
          mode="create"
          brands={brandRows}
          suppliers={supplierRows}
          locations={locationRows}
          requestId={prefill?.requestId}
          initial={prefill ? {
            brandId: prefill.brandId ?? '',
            model: prefill.model ?? '',
            supplierId: prefill.supplierId ?? '',
            purchaseAmount: prefill.purchaseAmount,
            estSaleAmount: prefill.estSaleAmount,
            notes: prefill.notes,
          } : undefined}
        />
      </div>
    </>
  )
}
