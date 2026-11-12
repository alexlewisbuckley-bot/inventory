import { type NextRequest } from 'next/server'
import { getPartnerLogoByPortalToken } from '@/server/services/partner-service'

export const dynamic = 'force-dynamic'

/**
 * The partner's own mark, on their portal.
 *
 * Found by the portal token and nothing else. No passphrase: it is the logo
 * the company puts on its own website, and a gate on it would only mean the
 * sign-in page could not show whose door it is — which is the one thing that
 * tells somebody they are at the right address.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } },
) {
  const logo = await getPartnerLogoByPortalToken(params.token)
  if (!logo) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(logo.data), {
    headers: {
      'Content-Type': logo.mimeType,
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
