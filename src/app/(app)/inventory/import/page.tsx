import type { Metadata } from 'next'
import { asc, isNull } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { locations } from '@/server/db/schema'
import { PageHeader } from '@/components/layout/PageHeader'
import { ImportWizard } from '@/components/inventory/ImportWizard'

export const metadata: Metadata = { title: 'Import stock' }
export const dynamic = 'force-dynamic'

export default async function ImportPage() {
  await requireCapability('data:import')
  const locationRows = await db.select({ name: locations.name }).from(locations)
    .where(isNull(locations.deletedAt)).orderBy(asc(locations.sortOrder))

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Import' }]}
        title="Import stock"
        description="Bring watches in from a spreadsheet. Nothing is written until you have reviewed what will happen."
      />
      <ImportWizard locationNames={locationRows.map((l) => l.name)} />
    </>
  )
}
