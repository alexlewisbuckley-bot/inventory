import { NextResponse } from 'next/server'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getSessionUser } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { notifications } from '@/server/db/schema'

export const dynamic = 'force-dynamic'

/**
 * What is waiting, asked for repeatedly and cheaply.
 *
 * The bell was rendered with the page, so a notification written while
 * somebody was looking at a screen did not reach them until they happened to
 * navigate — which for an owner sitting on the inventory list all afternoon
 * is not at all.
 *
 * Polled rather than streamed. A stream would hold a serverless function open
 * and the platform closes one after sixty seconds anyway, so the choice is
 * between a reconnect loop pretending to be a stream and asking a question
 * every half minute. This is two indexed reads against one user's rows.
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const [unread, latest] = await Promise.all([
    db.select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
    db.select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      entityType: notifications.entityType,
      entityId: notifications.entityId,
      createdAt: notifications.createdAt,
    })
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(1),
  ])

  return NextResponse.json(
    { unread: unread.length, latest: latest[0] ?? null },
    // Never cached. A count that is thirty seconds stale is the thing this
    // route exists to stop.
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
