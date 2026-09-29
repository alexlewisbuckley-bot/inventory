import { type NextRequest } from 'next/server'
import { getShopImage } from '@/server/services/reseller-service'

export const dynamic = 'force-dynamic'

/**
 * A stock photograph, for a shop window.
 *
 * Under the token rather than beside the signed-in image route, because that
 * one is behind a session and this one cannot be. The token is checked again
 * here and the image must belong to a watch that is actually on sale: the id
 * appears in the markup of the page, so an id on its own must open nothing.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string; id: string } },
) {
  const image = await getShopImage(params.token, params.id)
  if (!image) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.mimeType,
      'Content-Length': String(image.byteSize),
      // Cacheable by the browser but never by a shared cache: the URL carries
      // the token, and a proxy holding these would outlive a revoked link.
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
