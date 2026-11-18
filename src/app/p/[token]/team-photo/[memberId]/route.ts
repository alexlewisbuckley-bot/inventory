import { type NextRequest } from 'next/server'
import { getPortalDoor } from '@/server/services/partner-portal-service'
import { getTeamPhoto } from '@/server/services/leaderboard-service'
import { hasPortalPass } from '@/server/auth/portal-pass'

export const dynamic = 'force-dynamic'

/**
 * A photo of one of the partner's own people, for their Settings page.
 *
 * Behind the portal pass, unlike the logo: these are pictures of a
 * company's staff, and the token in a link is not reason enough to show them.
 */
export async function GET(_request: NextRequest, { params }: { params: { token: string; memberId: string } }) {
  const door = await getPortalDoor(params.token)
  if (!door || !await hasPortalPass(params.token, door.passwordHash, door.passwordSetAt)) {
    return new Response('Not found', { status: 404 })
  }
  const photo = await getTeamPhoto(door.id, params.memberId)
  if (!photo) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(photo.data), {
    headers: {
      'Content-Type': photo.mimeType,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
