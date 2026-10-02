import type { Metadata } from 'next'
import { asc, count, eq, isNull } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { brands, watchImages, watches } from '@/server/db/schema'
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

  const [stock, tallies] = await Promise.all([
    db
      .select({
        id: watches.id,
        stockNo: watches.stockNo,
        serial: watches.serial,
        // `model` is the reference — 126711CHNR, 5167R — and it is what people
        // name photographs after, because it is what is written on the watch.
        reference: watches.model,
        brandName: brands.name,
        // What it is called in words. Files do arrive named `Day-Date
        // Masterpiece.png`, so the picker has to be able to rank on this.
        nickname: watches.nickname,
      })
      .from(watches)
      .innerJoin(brands, eq(brands.id, watches.brandId))
      .where(isNull(watches.deletedAt))
      .orderBy(asc(watches.stockNo)),
    // What each watch already has, counted by kind. Two small queries rather
    // than a join, because joining photographs onto stock multiplies the rows
    // — and these are needed per kind anyway, so that a row can say "already
    // has two" before anybody presses Attach.
    db
      .select({ watchId: watchImages.watchId, kind: watchImages.kind, n: count() })
      .from(watchImages)
      .groupBy(watchImages.watchId, watchImages.kind),
  ])

  const byKind = new Map<string, Record<string, number>>()
  for (const tally of tallies) {
    const held = byKind.get(tally.watchId) ?? {}
    held[tally.kind] = tally.n
    byKind.set(tally.watchId, held)
  }

  const candidates = stock.map((watch) => {
    const held = byKind.get(watch.id) ?? {}
    return {
      ...watch,
      // A watch with no photographs is the likeliest subject of a photograph
      // somebody is uploading, which is how the picker orders its fallback.
      photographs: Object.values(held).reduce((total, n) => total + n, 0),
      photographsByKind: held,
    }
  })

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
