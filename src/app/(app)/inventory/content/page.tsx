import type { Metadata } from 'next'
import Link from 'next/link'
import { requireCapability } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { findWatches } from '@/server/repositories/watch-repository'
import { shopVocabulary } from '@/server/services/shopify-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { ContentGrid, type ContentRow } from '@/components/inventory/ContentGrid'
import { HELD_STATUSES } from '@/lib/enums'

export const metadata: Metadata = { title: 'Shop content' }
export const dynamic = 'force-dynamic'

/**
 * Reads the shop's vocabulary as well as the book, and the shop is somebody
 * else's API. Not the five minutes a push needs, but more than the default.
 */
export const maxDuration = 60

/**
 * Filling in what the shop shows.
 *
 * The push can only send what has been recorded, and the recording was
 * happening one watch at a time through a form behind a drawer — so it mostly
 * was not happening. A third of the live products reached the storefront with
 * no dial colour at all, which means a third of the stock is invisible to
 * anybody browsing by dial colour, which is most of the point of having the
 * filters.
 *
 * This is the other half of the Online shop page. That one says what the shop
 * is missing; this is where it gets typed.
 */
export default async function ShopContentPage() {
  const user = await requireCapability('watch:read')

  // Everything held, in one go. A hundred and forty rows of short text is a
  // smaller payload than one of the photographs beside it, and paging a
  // worklist means losing your place every time a page turns.
  const [result, vocabulary] = await Promise.all([
    findWatches({
      status: [...HELD_STATUSES],
      sort: 'stockNo',
      dir: 'asc',
      page: 1,
      perPage: 200,
      includeDeleted: false,
    }),
    shopVocabulary(),
  ])

  const rows: ContentRow[] = result.items.map((watch) => ({
    id: watch.id,
    stockNo: watch.stockNo,
    locationName: watch.locationName,
    brandName: watch.brandName,
    model: watch.model,
    nickname: watch.nickname,
    year: watch.year,
    dial: watch.dial,
    caseMaterial: watch.caseMaterial,
    caseSizeMm: watch.caseSizeMm,
    bracelet: watch.bracelet,
    movement: watch.movement,
    waterResistanceM: watch.waterResistanceM,
    condition: watch.condition,
    boxPapers: watch.boxPapers,
    description: watch.description,
    imageId: watch.primaryImageId ?? watch.tradeImageId,
  }))

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Shop content' }]}
        title="Shop content"
        description="Everything the website shows about a watch, in one grid. Tab across, Enter to save. Emptiest first."
      />

      {result.total > rows.length && (
        <p className="mb-4 rounded-md border border-state-warning/40 bg-state-warning/5 px-4 py-2.5 text-caption text-content-secondary">
          Showing the first {rows.length} of {result.total} held watches. Narrow the stock list and
          come back if the rest need filling in too.
        </p>
      )}

      <ContentGrid
        rows={rows}
        choices={vocabulary.choices}
        unmatched={vocabulary.unmatched}
        canEdit={can(user.role, 'watch:amend')}
      />

      <p className="mt-4 text-caption text-content-secondary">
        A warning triangle means the value is recorded and the shop has no entry for it, so
        nobody can browse by it. Add the entry in Shopify under Settings → Custom data, or
        change the wording here to match. The{' '}
        <Link href="/settings/storefront" className="font-semibold text-content-primary underline underline-offset-2">
          Online shop
        </Link>
        {' '}page lists them all and pushes the result.
      </p>
    </>
  )
}
