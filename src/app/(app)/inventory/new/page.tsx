import type { Metadata } from 'next'
import { asc, eq, isNull } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { brands, locations, suppliers } from '@/server/db/schema'
import { PageHeader } from '@/components/layout/PageHeader'
import { WatchForm } from '@/components/inventory/WatchForm'

export const metadata: Metadata = { title: 'Add a watch' }
export const dynamic = 'force-dynamic'

export default async function NewWatchPage() {
  await requireCapability('watch:create')

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
        title="Add a watch"
        description="Log a new purchase into stock. It appears in the inventory immediately."
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Add a watch' }]}
      />
      <div className="max-w-4xl">
        <WatchForm mode="create" brands={brandRows} suppliers={supplierRows} locations={locationRows} />
      </div>
    </>
  )
}
