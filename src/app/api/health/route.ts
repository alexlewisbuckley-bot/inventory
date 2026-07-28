import { NextResponse } from 'next/server'
import { checkDatabase } from '@/server/db/client'

export const dynamic = 'force-dynamic'

/**
 * Liveness and readiness probe.
 *
 * Reports separately on connectivity and on whether migrations have run, so a
 * deployment pointed at an empty database is diagnosable from the response
 * rather than from a wall of "relation does not exist" errors.
 */
export async function GET() {
  const { ok, migrated } = await checkDatabase()

  if (!ok) {
    return NextResponse.json(
      { status: 'unhealthy', database: 'unreachable', hint: 'Check DATABASE_URL and that the database accepts connections.' },
      { status: 503 },
    )
  }
  if (!migrated) {
    return NextResponse.json(
      { status: 'unmigrated', database: 'ok', hint: 'Run `npm run db:migrate` against this database.' },
      { status: 503 },
    )
  }

  return NextResponse.json({ status: 'ok', database: 'ok', time: new Date().toISOString() })
}
