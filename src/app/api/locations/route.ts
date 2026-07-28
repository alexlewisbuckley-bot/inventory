import { NextResponse } from 'next/server'
import { asc, isNull } from 'drizzle-orm'
import { db } from '@/server/db/client'
import { locations } from '@/server/db/schema'
import { getSessionUser } from '@/server/auth/session'

export const dynamic = 'force-dynamic'

/** Active locations, used by the move dialogs. */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const rows = await db
    .select({ id: locations.id, name: locations.name, type: locations.type, city: locations.city })
    .from(locations)
    .where(isNull(locations.deletedAt))
    .orderBy(asc(locations.sortOrder))

  return NextResponse.json({ locations: rows })
}
