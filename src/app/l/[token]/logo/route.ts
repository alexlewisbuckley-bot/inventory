import { type NextRequest } from 'next/server'
import { getLeaderboardLogo } from '@/server/services/leaderboard-service'

export const dynamic = 'force-dynamic'

/** The company's mark on its public board, found by the board's own token. */
export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const logo = await getLeaderboardLogo(params.token)
  if (!logo) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(logo.data), {
    headers: {
      'Content-Type': logo.mimeType,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
