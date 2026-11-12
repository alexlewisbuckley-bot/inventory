import { type NextRequest } from 'next/server'
import { getSessionUser } from '@/server/auth/session'
import { getPartnerLogo } from '@/server/services/partner-service'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/** A partner's mark, on our own screens. Behind the session, like every asset here. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser()
  if (!user) return new Response('Unauthorised', { status: 401 })
  if (!can(user.role, 'partner:read')) return new Response('Forbidden', { status: 403 })

  const logo = await getPartnerLogo(params.id)
  if (!logo) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(logo.data), {
    headers: {
      'Content-Type': logo.mimeType,
      'Cache-Control': 'private, max-age=600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
