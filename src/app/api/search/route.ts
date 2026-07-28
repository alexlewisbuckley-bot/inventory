import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, isNull, like, or, sql } from 'drizzle-orm'
import { db } from '@/server/db/client'
import { brands, watches } from '@/server/db/schema'
import { getSessionUser } from '@/server/auth/session'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/** Type-ahead search backing the command palette. */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!can(user.role, 'watch:read')) return NextResponse.json({ results: [] })

  const query = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (query.length < 2) return NextResponse.json({ results: [] })

  const term = `%${query.toLowerCase()}%`
  const rows = await db
    .select({
      id: watches.id, stockNo: watches.stockNo, model: watches.model,
      nickname: watches.nickname, serial: watches.serial,
      priceGbp: watches.purchasePriceGbp, brandName: brands.name,
    })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(and(
      isNull(watches.deletedAt),
      or(
        like(sql`lower(${watches.model})`, term),
        like(sql`lower(${watches.serial})`, term),
        like(sql`lower(${watches.nickname})`, term),
        like(sql`cast(${watches.stockNo} as text)`, term),
      ),
    ))
    .limit(8)

  return NextResponse.json({
    results: rows.map((row) => ({
      id: row.id,
      stockNo: row.stockNo,
      label: `${row.brandName} ${row.model}`,
      sublabel: [row.nickname, row.serial && `Serial ${row.serial}`].filter(Boolean).join(' · ') || 'No serial recorded',
      priceGbp: row.priceGbp,
    })),
  })
}
