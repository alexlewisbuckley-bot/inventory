import { type NextRequest } from 'next/server'
import { getTradeLogo } from '@/server/services/reseller-service'

export const dynamic = 'force-dynamic'

/**
 * The reseller's mark, on their own trade page.
 *
 * Found by the trade token, which is the only one this route is given. It
 * reused the shop window's lookup at first — which matches the public token
 * or the reseller's hostname — so it matched nothing and the page drew a
 * broken image next to the name.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } },
) {
  const logo = await getTradeLogo(params.token)
  if (!logo?.data) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(logo.data), {
    headers: {
      'Content-Type': logo.mimeType ?? 'image/png',
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
