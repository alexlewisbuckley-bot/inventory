import type { Metadata } from 'next'
import { asc, count, eq, isNull } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { db } from '@/server/db/client'
import { brands, locations, watchImages, watches } from '@/server/db/schema'
import { PageHeader } from '@/components/layout/PageHeader'
import { StockIntake } from '@/components/inventory/StockIntake'
import { aiConfigured } from '@/server/services/invoice-ai'

export const metadata: Metadata = { title: 'Bring stock in' }
export const dynamic = 'force-dynamic'

/**
 * Reading an invoice and creating stock takes longer than a page render.
 * 60s is the ceiling on Vercel's Hobby plan.
 */
export const maxDuration = 60

/**
 * One way in.
 *
 * Booking in an invoice, importing a spreadsheet and attaching photographs
 * were three buttons, which is the filing cabinet showing through: from where
 * somebody stands they are one errand, which is that there are files and they
 * need to go where they go. The three flows are unchanged behind this — only
 * the question at the front is, and it is now "what have you got" rather than
 * "which of our three importers did you mean".
 */
export default async function BringStockInPage() {
  // The weaker of the two doors onto this page: every role that may import
  // may also attach a photograph, so this lets in everybody who can do
  // anything here and nobody who cannot. What a given drop is allowed to do
  // is decided per kind, below.
  const user = await requireCapability('watch:update')
  const canImport = can(user.role, 'data:import')
  const canPhotograph = true

  const [locationRows, stock, tallies] = await Promise.all([
    canImport
      ? db.select({ name: locations.name }).from(locations)
        .where(isNull(locations.deletedAt)).orderBy(asc(locations.sortOrder))
      : Promise.resolve([]),
    canPhotograph
      ? db
        .select({
          id: watches.id,
          stockNo: watches.stockNo,
          serial: watches.serial,
          reference: watches.model,
          brandName: brands.name,
          nickname: watches.nickname,
        })
        .from(watches)
        .innerJoin(brands, eq(brands.id, watches.brandId))
        .where(isNull(watches.deletedAt))
        .orderBy(asc(watches.stockNo))
      : Promise.resolve([]),
    canPhotograph
      ? db.select({ watchId: watchImages.watchId, kind: watchImages.kind, n: count() })
        .from(watchImages).groupBy(watchImages.watchId, watchImages.kind)
      : Promise.resolve([]),
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
      photographs: Object.values(held).reduce((total, n) => total + n, 0),
      photographsByKind: held,
    }
  })

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Bring stock in' }]}
        title="Bring stock in"
        description="An invoice, a spreadsheet or a batch of photographs — drop it and it goes where it goes."
      />
      <StockIntake
        candidates={candidates}
        locationNames={locationRows.map((l) => l.name)}
        aiEnabled={aiConfigured()}
        canImport={canImport}
        canPhotograph={canPhotograph}
      />
    </>
  )
}
