import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/server/db/client'
import { watchImages, watches } from '@/server/db/schema'

export const dynamic = 'force-dynamic'

/** The statuses that mean the watch is ours to show. */
const HELD = ['IN_STOCK', 'RESERVED', 'SALE_AGREED'] as const

/**
 * A photograph, for the storefront to come and collect.
 *
 * Shopify fetches product media from a URL rather than being handed bytes, so
 * this is the one door into the image table that no session opens. It is
 * narrow on purpose, and the narrowing is the whole point:
 *
 *  - only `kind = 'WATCH'`. A warranty card carries a serial, a date and a
 *    dealer's stamp; a receipt carries what was paid. Neither belongs on a
 *    public URL, and the surest way to keep them off one is a door that
 *    cannot open them.
 *  - only stock we currently hold. A sold watch's photographs stop being
 *    fetchable the moment it is marked sold.
 *  - no listing, no enumeration, no ids but the one asked for.
 *
 * What remains reachable is a photograph of a watch that is, by the owner's
 * own instruction, about to be published on a public storefront anyway.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const rows = await db
    .select({
      data: watchImages.data,
      mimeType: watchImages.mimeType,
      byteSize: watchImages.byteSize,
    })
    .from(watchImages)
    .innerJoin(watches, eq(watches.id, watchImages.watchId))
    .where(and(
      eq(watchImages.id, params.id),
      eq(watchImages.kind, 'WATCH'),
      inArray(watches.status, [...HELD]),
      isNull(watches.deletedAt),
    ))
    .limit(1)

  const image = rows[0]
  if (!image) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.mimeType,
      'Content-Length': String(image.byteSize),
      // Shopify copies it once and serves its own from then on, so there is
      // nothing here worth a long cache — but a short one absorbs the retries
      // a failed media import makes.
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
