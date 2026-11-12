import { type NextRequest } from 'next/server'
import { getPortalDoor, getPortalImage } from '@/server/services/partner-portal-service'
import { hasPortalPass } from '@/server/auth/portal-pass'

export const dynamic = 'force-dynamic'

/**
 * A photograph, behind the same passphrase as the page that listed it.
 *
 * The token alone is not enough. A route that served these on a URL alone
 * would mean the passphrase guarded the page and nothing on it — and a
 * forwarded image link would be the whole room, at a price we negotiated with
 * one company and nobody else.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string; id: string } },
) {
  const door = await getPortalDoor(params.token)
  if (!door) return new Response('Not found', { status: 404 })
  if (!await hasPortalPass(params.token, door.passwordHash, door.passwordSetAt)) {
    return new Response('Not found', { status: 404 })
  }

  const image = await getPortalImage(params.token, params.id)
  if (!image) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.mimeType,
      'Content-Length': String(image.byteSize),
      // Never by a shared cache: the URL carries the token, and a proxy
      // holding these would outlive both a revoked link and a changed
      // passphrase.
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
