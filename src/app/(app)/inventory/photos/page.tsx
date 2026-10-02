import type { Metadata } from 'next'
import { asc, eq, isNull } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { brands, watches } from '@/server/db/schema'
import { PageHeader } from '@/components/layout/PageHeader'
import { PhotoIntake } from '@/components/inventory/PhotoIntake'

export const metadata: Metadata = { title: 'Add photographs' }

/**
 * Attaching photographs to stock in bulk.
 *
 * The gallery on a watch already takes several files at once, but only ever
 * for that one watch — the wrong shape for the job this exists to do: fifty
 * warranty cards photographed in one sitting, belonging to fifty different
 * watches. A watch at a time is fifty page loads.
 */
export default async function PhotoIntakePage() {
  // The same capability the single-watch gallery needs: the same write, in bulk.
  await requireCapability('watch:update')

  const candidates = await db
    .select({
      id: watches.id,
      stockNo: watches.stockNo,
      serial: watches.serial,
      // `model` is the reference — 126711CHNR, 5167R — and it is what people
      // name photographs after, because it is what is written on the watch.
      reference: watches.model,
      brandName: brands.name,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(isNull(watches.deletedAt))
    .orderBy(asc(watches.stockNo))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Add photographs"
        description="Drop in a batch and check every match before anything is saved."
      />
      <PhotoIntake candidates={candidates} />
    </div>
  )
}
