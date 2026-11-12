import { type NextRequest } from 'next/server'
import { getRecipientLogo } from '@/server/services/partner-campaign-service'

export const dynamic = 'force-dynamic'

/**
 * The company's mark, on the page one of their people opens.
 *
 * Found by the recipient's own token, so a link that is not a live invitation
 * draws nothing — the same answer the page itself gives.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } },
) {
  const logo = await getRecipientLogo(params.token)
  if (!logo) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(logo.data), {
    headers: {
      'Content-Type': logo.mimeType,
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
