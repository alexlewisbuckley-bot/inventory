import { type NextRequest } from 'next/server'
import { getAgentPhoto } from '@/server/services/leaderboard-service'

export const dynamic = 'force-dynamic'

/**
 * An agent's photo, by the board's share token.
 *
 * Served with its own type and nosniff, and only ever PNG, JPEG or WebP — the
 * upload refuses anything else — so a photo cannot be made to run as a page.
 * The URL carries a version, so it can be cached for a day.
 */
export async function GET(_request: NextRequest, { params }: { params: { token: string; agentId: string } }) {
  const photo = await getAgentPhoto(params.token, params.agentId)
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
