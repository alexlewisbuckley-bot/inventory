import { NextResponse, type NextRequest } from 'next/server'
import { getSessionUser } from '@/server/auth/session'
import { peek, type SearchKind } from '@/server/repositories/search-repository'
import { can, type Capability } from '@/lib/permissions'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/** Which capability each peekable kind needs. Absent means not peekable. */
const REQUIRED: Partial<Record<SearchKind, Capability>> = {
  watch: 'watch:read',
  contact: 'customer:read',
  deal: 'deal:read',
}

/**
 * Enough of a record to answer the phone without leaving the page.
 *
 * A separate endpoint from search rather than fatter search results: a peek is
 * asked for once, deliberately, by somebody who has already found the row —
 * loading six facts and three activity rows for every result in a list that
 * changes on every keystroke would spend the entire latency budget on data
 * nineteen of twenty rows will never show.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const kind = request.nextUrl.searchParams.get('kind') as SearchKind | null
  const id = request.nextUrl.searchParams.get('id')
  if (!kind || !id) return NextResponse.json({ error: 'Ask for a kind and an id' }, { status: 400 })

  const capability = REQUIRED[kind]
  if (!capability) return NextResponse.json({ error: 'Not peekable' }, { status: 404 })
  if (!can(user.role, capability)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const record = await peek(kind, id)
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ record })
  } catch (error) {
    logger.error('peek failed', { error: (error as Error).message, kind })
    return NextResponse.json({ error: 'Could not load that' }, { status: 500 })
  }
}
