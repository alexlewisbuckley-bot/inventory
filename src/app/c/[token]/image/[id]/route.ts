import { type NextRequest } from 'next/server'
import { getCatalogueImage } from '@/server/services/catalogue-link-service'

export const dynamic = 'force-dynamic'

/**
 * A photograph from a catalogue link, guarded by the same token as the page
 * that listed it.
 *
 * The token alone is the whole of it, as it is on the shop window and unlike
 * the reseller trade room — that one sits behind a passphrase, so serving its
 * images on a URL alone would have meant the passphrase guarded the page and
 * nothing on it. There is no passphrase here to undermine.
 *
 * Which photographs can be reached is decided in the service, against the
 * same predicate that built the list: the right kinds only, from a location
 * this link may show, for a watch still in stock. A watch that has left the
 * list stops serving its pictures at the same moment.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string; id: string } },
) {
  const image = await getCatalogueImage(params.token, params.id)
  if (!image) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.mimeType,
      'Content-Length': String(image.byteSize),
      // Never by a shared cache: the URL carries the token, and a proxy
      // holding these would outlive a revoked link. An hour in the dealer's
      // own browser is the whole of it.
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
