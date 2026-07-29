import { NextResponse, type NextRequest } from 'next/server'
import { getSessionUser } from '@/server/auth/session'
import { search } from '@/server/repositories/search-repository'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/**
 * The palette's back end.
 *
 * V1 searched one table and returned eight watches. It now answers across six
 * object types, filtered by what the caller is allowed to see — the filtering
 * happens in the repository against the session's role rather than here,
 * because a permission check that lives next to the query cannot be forgotten
 * by the next endpoint that calls it.
 *
 * `tookMs` comes back with the results. It is not decoration: the palette has
 * a 100ms budget, and a budget nobody can observe is a budget nobody keeps.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const query = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (query.length < 2) return NextResponse.json({ hits: [], tookMs: 0 })

  try {
    const results = await search(query, user.role)
    if (results.tookMs > 100) {
      // Logged rather than thrown. A slow search is still a useful search; a
      // slow search nobody knows about is how it becomes a slow product.
      logger.warn('search over budget', { tookMs: results.tookMs, length: query.length })
    }
    return NextResponse.json(results)
  } catch (error) {
    logger.error('search failed', { error: (error as Error).message })
    return NextResponse.json({ error: 'Search is unavailable' }, { status: 500 })
  }
}
