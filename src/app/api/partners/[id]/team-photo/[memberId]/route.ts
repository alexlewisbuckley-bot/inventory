import { NextResponse, type NextRequest } from 'next/server'
import { getSessionUser } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { getTeamPhoto } from '@/server/services/leaderboard-service'

export const dynamic = 'force-dynamic'

/** A partner team member's photo, for our staff on the partner's page. */
export async function GET(_request: NextRequest, { params }: { params: { id: string; memberId: string } }) {
  const user = await getSessionUser()
  if (!user || !can(user.role, 'partner:read')) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const photo = await getTeamPhoto(params.id, params.memberId)
  if (!photo) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(photo.data), {
    headers: {
      'Content-Type': photo.mimeType,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
