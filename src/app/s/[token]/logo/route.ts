import { type NextRequest } from 'next/server'
import { getShopLogo } from '@/server/services/reseller-service'

export const dynamic = 'force-dynamic'

/** The reseller's logo, behind the same token as their page. */
export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const logo = await getShopLogo(params.token)
  if (!logo) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(logo.data), {
    headers: {
      'Content-Type': logo.mimeType,
      'Content-Length': String(logo.data.byteLength),
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
