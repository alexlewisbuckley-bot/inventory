import { type NextRequest } from 'next/server'
import { getTradeDoor, getTradeImage } from '@/server/services/reseller-service'
import { hasTradePass } from '@/server/auth/trade-pass'

export const dynamic = 'force-dynamic'

/**
 * A trade photograph, behind the same passphrase as the page that listed it.
 *
 * Unlike the shop window's image route, the token alone is not enough here.
 * That one guards pictures meant for the public and the token only decides
 * whose shop they belong to; these are the dealer's-eye photographs, and a
 * route that served them on a URL alone would mean the passphrase guarded the
 * page and nothing on it — a forwarded image link would be the whole room.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string; id: string } },
) {
  const door = await getTradeDoor(params.token)
  if (!door) return new Response('Not found', { status: 404 })
  if (!await hasTradePass(params.token, door.passwordHash, door.passwordSetAt)) {
    return new Response('Not found', { status: 404 })
  }

  const image = await getTradeImage(params.token, params.id)
  if (!image) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.mimeType,
      'Content-Length': String(image.byteSize),
      // Never by a shared cache: the URL carries the token, and a proxy
      // holding these would outlive both a revoked link and a changed
      // passphrase. An hour in the dealer's own browser is the whole of it.
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
