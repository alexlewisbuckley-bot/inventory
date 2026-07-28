import { desc, eq, and, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { auditLogs, users } from '../db/schema'
import { newId } from '@/lib/ids'
import type { AuditAction } from '@/lib/enums'

export interface AuditInput {
  entityType: string
  entityId: string
  action: AuditAction
  summary?: string
  actorId?: string | null
  ipAddress?: string | null
  changes?: Record<string, { from: unknown; to: unknown }>
}

/**
 * Append an immutable audit record.
 *
 * Callers should run this inside the same transaction as the change it
 * describes so the log can never disagree with the data.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  await db.insert(auditLogs).values({
    id: newId('aud'),
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    summary: input.summary ?? null,
    actorId: input.actorId ?? null,
    ipAddress: input.ipAddress ?? null,
    changes: input.changes && Object.keys(input.changes).length > 0 ? JSON.stringify(input.changes) : null,
  })
}

/**
 * Field-level diff between two versions of an entity, limited to `fields`.
 * Returns undefined when nothing changed so no-op saves write no audit noise.
 */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[],
): Record<string, { from: unknown; to: unknown }> | undefined {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of fields) {
    if (!(field in after)) continue
    const from = before[field]
    const to = after[field]
    const same = from instanceof Date && to instanceof Date
      ? from.getTime() === to.getTime()
      : from === to
    if (!same) changes[String(field)] = { from: normalise(from), to: normalise(to) }
  }
  return Object.keys(changes).length > 0 ? changes : undefined
}

const normalise = (value: unknown): unknown => (value instanceof Date ? value.toISOString() : value)

export interface AuditEntry {
  id: string
  entityType: string
  entityId: string
  action: AuditAction
  summary: string | null
  changes: Record<string, { from: unknown; to: unknown }> | null
  createdAt: Date
  actor: { id: string; name: string; initials: string } | null
}

/** Timeline for one entity, newest first. */
export async function auditForEntity(entityType: string, entityId: string, limit = 50): Promise<AuditEntry[]> {
  const rows = await db
    .select({
      log: auditLogs,
      actorId: users.id, actorName: users.name, actorInitials: users.initials,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
  return rows.map(mapEntry)
}

export interface AuditQuery {
  page?: number
  perPage?: number
  entityType?: string
  action?: AuditAction
  actorId?: string
}

/** Paginated system-wide audit trail. */
export async function auditTrail(query: AuditQuery = {}): Promise<{ entries: AuditEntry[]; total: number }> {
  const page = Math.max(1, query.page ?? 1)
  const perPage = Math.min(100, Math.max(1, query.perPage ?? 25))

  const filters = [
    query.entityType ? eq(auditLogs.entityType, query.entityType) : undefined,
    query.action ? eq(auditLogs.action, query.action) : undefined,
    query.actorId ? eq(auditLogs.actorId, query.actorId) : undefined,
  ].filter(Boolean)
  const where = filters.length > 0 ? and(...(filters as never[])) : undefined

  const [rows, counted] = await Promise.all([
    db.select({
        log: auditLogs,
        actorId: users.id, actorName: users.name, actorInitials: users.initials,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ count: sql<number>`count(*)` }).from(auditLogs).where(where),
  ])

  return { entries: rows.map(mapEntry), total: Number(counted[0]?.count ?? 0) }
}

type Row = {
  log: typeof auditLogs.$inferSelect
  actorId: string | null
  actorName: string | null
  actorInitials: string | null
}

function mapEntry(row: Row): AuditEntry {
  return {
    id: row.log.id,
    entityType: row.log.entityType,
    entityId: row.log.entityId,
    action: row.log.action,
    summary: row.log.summary,
    changes: row.log.changes ? (JSON.parse(row.log.changes) as AuditEntry['changes']) : null,
    createdAt: row.log.createdAt,
    actor: row.actorId ? { id: row.actorId, name: row.actorName!, initials: row.actorInitials! } : null,
  }
}
