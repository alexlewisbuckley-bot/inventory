import type { Metadata } from 'next'
import Link from 'next/link'
import { requireCapability } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { findWatches } from '@/server/repositories/watch-repository'
import { shopVocabulary } from '@/server/services/shopify-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { ContentGrid, type ContentRow } from '@/components/inventory/ContentGrid'
import { HELD_STATUSES } from '@/lib/enums'
import { cardGaps } from '@/lib/shopify-map'

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
  // Merchandising, not reference. The page is a working surface for what
  // the shop says about a watch, and every action on it already requires
  // being able to change one — so reading it asks the same.
  const user = await requireCapability('watch:update')

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

  /*
   * What the shop window cannot say yet.
   *
   * The push can only send what was recorded, and a card falls back to the
   * bare reference when there is no model name — which is why the shelf
   * showed "Sky Dweller", "126503" and "Datejust 36mm" beside each other.
   * The size now always goes on the card where it is known, but no mapping
   * can invent a name nobody typed, so the gap is counted here instead of
   * being discovered on the website.
   */
  const gaps = rows.map((row) => cardGaps(row))
  const noModel = gaps.filter((gap) => gap.includes('model')).length
  const noSize = gaps.filter((gap) => gap.includes('size')).length

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Shop content' }]}
        title="Shop content"
        description="Everything the website shows about a watch, in one grid. Tab across, Enter to save. Emptiest first."
      />

      {(noModel > 0 || noSize > 0) && (
        <p className="mb-4 rounded-md border border-state-warning/40 bg-state-warning/5 px-4 py-2.5 text-caption text-content-secondary">
          <span className="font-semibold text-content-primary">
            Product cards are missing information.
          </span>{' '}
          Every card shows the brand, the model and the size, and a card with no
          model name falls back to the reference number on its own.{' '}
          {noModel > 0 && (
            <>
              <span className="font-semibold text-content-primary">{noModel}</span>
              {' '}of {rows.length} held watches have no model name — that is the
              Title column below, where &ldquo;Submariner Date&rdquo; or
              &ldquo;Datejust 41&rdquo; goes.{' '}
            </>
          )}
          {noSize > 0 && (
            <>
              <span className="font-semibold text-content-primary">{noSize}</span>
              {' '}have no case size — the Size column. Filling either one fixes that
              watch&rsquo;s card on the next push.
            </>
          )}
        </p>
      )}

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
        change the wording here to match. Material is the exception: it is a fixed list of
        nine, and whatever is typed is filed under one of them on the way to the shop — so a
        watch recorded as Oystersteel reaches the website as Steel. The{' '}
        <Link href="/settings/storefront" className="font-semibold text-content-primary underline underline-offset-2">
          Online shop
        </Link>
        {' '}page lists them all and pushes the result.
      </p>
    </>
  )
}
