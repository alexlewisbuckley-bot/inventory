import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client'
import { brands, locations, watchImages, watches } from '../db/schema'
import { pickPostImage, whatsappPost } from '@/lib/whatsapp-post'
import type { GroupPost, GroupPostBatch } from '@/lib/group-post'
import { formatCurrency } from '@/lib/currency'
import { BASE_CURRENCY } from '@/lib/enums'

/**
 * A batch of watches, written out for a dealer group.
 *
 * Assembled on the server rather than from what the list happens to be
 * holding, for two reasons. The capability is asserted here, so a selection
 * cannot be turned into trade prices by anybody who did not have them to
 * begin with; and the skips are decided against the record rather than
 * against a row that may have been rendered minutes ago.
 */

/**
 * Build the batch, in the order the watches were selected.
 *
 * A watch is left out rather than posted badly. Sold, because offering a
 * gone piece at a trade price is an embarrassment; in transit, because a
 * piece in a courier's bag cannot be shown to anybody who says yes; no
 * photograph, because a caption on its own is a weak post; no trade price,
 * because an unpriced piece in a trade group reads as an oversight
 * rather than a decision. Each
 * omission is reported with its reason, so a batch of ten going out as seven
 * is something the sender knows about rather than discovers later.
 */
export async function buildGroupPosts(watchIds: string[]): Promise<GroupPostBatch> {
  if (watchIds.length === 0) return { posts: [], skipped: [] }

  const rows = await db
    .select({
      id: watches.id,
      stockNo: watches.stockNo,
      model: watches.model,
      modelName: watches.modelName,
      year: watches.year,
      status: watches.status,
      tradePriceGbp: watches.tradePriceGbp,
      brandName: brands.name,
      here: locations.publishToStorefront,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .innerJoin(locations, eq(locations.id, watches.locationId))
    .where(and(inArray(watches.id, watchIds), isNull(watches.deletedAt)))

  const images = await db
    .select({ id: watchImages.id, watchId: watchImages.watchId, kind: watchImages.kind })
    .from(watchImages)
    .where(inArray(watchImages.watchId, watchIds))

  const byWatch = new Map<string, Array<{ id: string; kind: string }>>()
  for (const image of images) {
    const list = byWatch.get(image.watchId) ?? []
    list.push({ id: image.id, kind: image.kind })
    byWatch.set(image.watchId, list)
  }

  // Selection order, not database order: somebody who picked six watches in
  // a particular order is working through them in that order.
  const order = new Map(watchIds.map((id, index) => [id, index]))
  const sorted = [...rows].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

  const posts: GroupPost[] = []
  const skipped: GroupPostBatch['skipped'] = []

  for (const row of sorted) {
    const watch = {
      brandName: row.brandName,
      model: row.model,
      modelName: row.modelName,
      year: row.year,
    }
    const label = [row.brandName, row.modelName ?? row.model].filter(Boolean).join(' ')

    if (row.status === 'SOLD') {
      skipped.push({ stockNo: row.stockNo, label, reason: 'sold' })
      continue
    }
    /*
     * In the building, not merely in stock.
     *
     * "In transit" is a location, not a status, so a watch being carried
     * between them is IN_STOCK the whole way and sailed past the check
     * above. Offering a trade price on a piece that is in a courier's bag
     * is the same embarrassment as offering a sold one — worse, because
     * the dealer will say yes and then be waited on.
     *
     * Read from the location's own publish switch, as the storefront, the
     * catalogue and the reseller doors all do, rather than from its type.
     */
    if (!row.here) {
      skipped.push({ stockNo: row.stockNo, label, reason: 'not-here' })
      continue
    }
    if (!row.tradePriceGbp) {
      skipped.push({ stockNo: row.stockNo, label, reason: 'no-price' })
      continue
    }
    const imageId = pickPostImage(byWatch.get(row.id) ?? [])
    if (!imageId) {
      skipped.push({ stockNo: row.stockNo, label, reason: 'no-photo' })
      continue
    }

    posts.push({
      watchId: row.id,
      stockNo: row.stockNo,
      label,
      imageId,
      caption: whatsappPost(watch, {
        // Dirhams, not the reader's display currency: the message is going
        // to a dealer group in Dubai, not onto this screen.
        tradePrice: formatCurrency(row.tradePriceGbp, BASE_CURRENCY),
      }),
    })
  }

  return { posts, skipped }
}
