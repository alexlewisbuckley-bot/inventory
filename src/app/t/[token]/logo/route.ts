import { type NextRequest } from 'next/server'
import { getShopLogo } from '@/server/services/reseller-service'

export const dynamic = 'force-dynamic'

/**
 * The reseller's mark, on their own trade page.
 *
 * Looked up by their public token rather than the trade one: a logo is on
 * every page of their shop already and is not a thing the passphrase is
 * protecting, so this reuses the door that already serves it rather than
 * opening a second one onto the same bytes.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } },
) {
  const logo = await getShopLogo(params.token)
  if (!logo?.data) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(logo.data), {
    headers: {
      'Content-Type': logo.mimeType ?? 'image/png',
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
