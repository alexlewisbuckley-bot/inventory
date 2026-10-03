import { type NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { requireCapability } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { watches } from '@/server/db/schema'
import { listLibrary } from '@/server/services/image-service'

export const dynamic = 'force-dynamic'

/**
 * What the photograph library holds for one watch's reference.
 *
 * Asked for by the watch's own id rather than by a reference, so a caller
 * cannot go browsing the shelf for a model it is not looking at — and so the
 * brand is resolved here, where it cannot be got wrong.
 */
export async function GET(request: NextRequest) {
  await requireCapability('watch:update')

  const watchId = request.nextUrl.searchParams.get('watchId')
  if (!watchId) return NextResponse.json({ error: 'No watch specified.' }, { status: 400 })

  const rows = await db
    .select({ brandId: watches.brandId, reference: watches.model })
    .from(watches).where(eq(watches.id, watchId)).limit(1)
  if (!rows[0]) return NextResponse.json({ error: 'No such watch.' }, { status: 404 })

  return NextResponse.json({
    reference: rows[0].reference,
    images: await listLibrary(rows[0].brandId, rows[0].reference),
  })
}
