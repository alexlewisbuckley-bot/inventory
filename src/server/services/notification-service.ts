import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { notifications } from '../db/schema'
import type { NotificationType } from '@/lib/enums'

export interface NotificationRow {
  id: string
  type: NotificationType
  title: string
  body: string | null
  entityType: string | null
  entityId: string | null
  readAt: Date | null
  createdAt: Date
}

export async function listNotifications(userId: string, limit = 50): Promise<NotificationRow[]> {
  const rows = await db.select().from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
  return rows.map((row) => ({ ...row, type: row.type as NotificationType }))
}

export async function unreadCount(userId: string): Promise<number> {
  const rows = await db.select({ value: sql<number>`count(*)` }).from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
  return Number(rows[0]?.value ?? 0)
}

/** Scoped by userId so one user can never mark another's notification read. */
export async function markRead(id: string, userId: string): Promise<void> {
  await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
}

export async function markAllRead(userId: string): Promise<number> {
  const pending = await unreadCount(userId)
  await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
  return pending
}
