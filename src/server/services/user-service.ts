import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { sessions, userPreferences, users } from '../db/schema'
import { hashPassword, assessPassword } from '../auth/password'
import { revokeAllSessions } from '../auth/session'
import { recordAudit } from './audit'
import { diff } from '@/lib/diff'
import { newId, initialsOf } from '@/lib/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { assignableRoles } from '@/lib/permissions'
import type { SessionUser } from '../auth/session'
import type { Role } from '@/lib/enums'

export interface UserRow {
  id: string
  name: string
  email: string
  role: Role
  jobTitle: string | null
  phone: string | null
  initials: string
  isActive: boolean
  lastLoginAt: Date | null
  createdAt: Date
  activeSessions: number
}

export async function listUsers(): Promise<UserRow[]> {
  const rows = await db
    .select({
      id: users.id, name: users.name, email: users.email, role: users.role,
      jobTitle: users.jobTitle, phone: users.phone, initials: users.initials,
      isActive: users.isActive, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
      activeSessions: sql<number>`(
        SELECT count(*) FROM sessions
        WHERE sessions.user_id = users.id AND sessions.expires_at > now()
      )`,
    })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(desc(users.createdAt))

  return rows.map((row) => ({ ...row, role: row.role as Role, activeSessions: Number(row.activeSessions) }))
}

/**
 * Create a user.
 *
 * The actor may only assign roles at or below their own level, so a manager
 * cannot mint an owner and escalate laterally.
 */
export async function createUser(
  input: { name: string; email: string; role: Role; jobTitle: string | null; phone: string | null; password: string },
  actor: SessionUser,
): Promise<string> {
  if (!assignableRoles(actor.role).includes(input.role)) {
    throw new ValidationError(`Your role cannot assign the ${input.role.toLowerCase()} role.`, { role: 'Not assignable by you.' })
  }

  const strength = assessPassword(input.password, [input.email, input.name])
  if (!strength.valid) throw new ValidationError(strength.problems[0]!, { password: strength.problems[0]! })

  return withTransaction(async () => {
    const clash = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1)
    if (clash[0]) throw new ConflictError('That email address is already registered.', { email: 'Already in use.' })

    const id = newId('usr')
    await db.insert(users).values({
      id, name: input.name, email: input.email, role: input.role,
      jobTitle: input.jobTitle, phone: input.phone,
      initials: initialsOf(input.name), passwordHash: await hashPassword(input.password),
    })
    await db.insert(userPreferences).values({ userId: id })
    await recordAudit({
      entityType: 'User', entityId: id, action: 'CREATE', actorId: actor.id,
      summary: `${input.name} added as ${input.role.toLowerCase()}`,
    })
    return id
  })
}

export async function updateUser(
  id: string,
  input: { name?: string; role?: Role; jobTitle?: string | null; phone?: string | null; isActive?: boolean },
  actor: SessionUser,
): Promise<void> {
  if (input.role && !assignableRoles(actor.role).includes(input.role)) {
    throw new ValidationError(`Your role cannot assign the ${input.role.toLowerCase()} role.`, { role: 'Not assignable by you.' })
  }

  await withTransaction(async () => {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
    const existing = rows[0]
    if (!existing || existing.deletedAt) throw new NotFoundError('User')

    // Guard against locking the organisation out of its own admin functions.
    if ((input.role && input.role !== 'OWNER') || input.isActive === false) {
      if (existing.role === 'OWNER') await assertNotLastOwner(existing.id)
    }
    if (existing.id === actor.id && input.isActive === false) {
      throw new ValidationError('You cannot deactivate your own account.')
    }

    const patch: Record<string, unknown> = { ...input, updatedAt: new Date() }
    if (input.name) patch.initials = initialsOf(input.name)

    await db.update(users).set(patch).where(eq(users.id, id))

    // Deactivating must take effect immediately, not at token expiry.
    if (input.isActive === false) await revokeAllSessions(id)

    await recordAudit({
      entityType: 'User', entityId: id, action: 'UPDATE', actorId: actor.id,
      summary: `${existing.name} updated`,
      changes: diff(existing, input, ['name', 'role', 'jobTitle', 'phone', 'isActive']),
    })
  })
}

/** Soft-delete a user and kill their sessions. */
export async function deleteUser(id: string, actor: SessionUser): Promise<void> {
  if (id === actor.id) throw new ValidationError('You cannot delete your own account.')

  await withTransaction(async () => {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
    const existing = rows[0]
    if (!existing || existing.deletedAt) throw new NotFoundError('User')
    if (existing.role === 'OWNER') await assertNotLastOwner(id)

    await db.update(users)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(eq(users.id, id))
    await recordAudit({
      entityType: 'User', entityId: id, action: 'DELETE', actorId: actor.id,
      summary: `${existing.name} removed`,
    })
  })
  await revokeAllSessions(id)
}

/** Administrative password reset. Forces re-login everywhere. */
export async function resetUserPassword(id: string, password: string, actor: SessionUser): Promise<void> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
  const existing = rows[0]
  if (!existing || existing.deletedAt) throw new NotFoundError('User')

  const strength = assessPassword(password, [existing.email, existing.name])
  if (!strength.valid) throw new ValidationError(strength.problems[0]!, { password: strength.problems[0]! })

  await withTransaction(async () => {
    await db.update(users)
      .set({ passwordHash: await hashPassword(password), tokenVersion: existing.tokenVersion + 1, updatedAt: new Date() })
      .where(eq(users.id, id))
    await recordAudit({
      entityType: 'User', entityId: id, action: 'PASSWORD_CHANGE', actorId: actor.id,
      summary: `Password reset for ${existing.name} by ${actor.name}`,
    })
  })
  await revokeAllSessions(id)
}

/** Refuse any change that would leave the organisation with no active owner. */
async function assertNotLastOwner(excludingId: string): Promise<void> {
  const remaining = await db.select({ value: count() }).from(users)
    .where(and(eq(users.role, 'OWNER'), eq(users.isActive, true), isNull(users.deletedAt), sql`${users.id} != ${excludingId}`))
  if (Number(remaining[0]?.value ?? 0) === 0) {
    throw new ValidationError('There must always be at least one active owner. Promote another user first.')
  }
}

/** Sessions for the profile page's "signed in devices" list. */
export async function listSessions(userId: string) {
  return db
    .select({
      id: sessions.id, userAgent: sessions.userAgent, ipAddress: sessions.ipAddress,
      createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.lastSeenAt))
}
