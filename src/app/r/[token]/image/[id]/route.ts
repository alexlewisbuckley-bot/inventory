import { type NextRequest } from 'next/server'
import { getRecipientImage } from '@/server/services/partner-campaign-service'

export const dynamic = 'force-dynamic'

/**
 * A photograph, behind the same link as the page that listed it.
 *
 * The id alone is not enough: the image has to belong to a watch this
 * particular invitation is actually offering. Otherwise the route is a way to
 * read any photograph in the system by guessing at ids, from a link that was
 * emailed to somebody's whole sales floor.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string; id: string } },
) {
  const image = await getRecipientImage(params.token, params.id)
  if (!image) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.mimeType,
      'Content-Length': String(image.byteSize),
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
