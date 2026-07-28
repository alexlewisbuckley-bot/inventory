import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/server/db/client'

export const dynamic = 'force-dynamic'

/** Liveness/readiness probe: confirms the process is up and the DB answers. */
export async function GET() {
  try {
    await db.get(sql`SELECT 1`)
    return NextResponse.json({ status: 'ok', database: 'ok', time: new Date().toISOString() })
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'unreachable' }, { status: 503 })
  }
}
