import { eq, and, isNull } from 'drizzle-orm'
import { headers } from 'next/headers'
import { db, withTransaction } from '../db/client'
import { users, userPreferences } from '../db/schema'
import { hashPassword, verifyPassword, assessPassword } from '../auth/password'
import { createSession, destroySession, pruneExpiredSessions, revokeAllSessions } from '../auth/session'
import { rateLimit, resetRateLimit, LIMITS } from '../auth/rate-limit'
import { recordAudit } from './audit'
import { AppError, UnauthorizedError, ValidationError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { LoginInput } from '@/lib/validation'

const clientIp = (): string =>
  headers().get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

/**
 * Authenticate and start a session.
 *
 * Failures return one generic message regardless of cause so the endpoint
 * cannot be used to enumerate registered email addresses. Rate limiting is
 * applied per email *and* per IP to blunt both targeted and spray attacks.
 */
export async function login(input: LoginInput): Promise<void> {
  const ip = clientIp()
  rateLimit({ key: `login:ip:${ip}`, ...LIMITS.login })
  rateLimit({ key: `login:email:${input.email}`, ...LIMITS.login })

  const generic = new AppError('Email address or password is incorrect.', 401, 'INVALID_CREDENTIALS')

  const rows = await db.select().from(users)
    .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
    .limit(1)
  const user = rows[0]

  if (!user) {
    // Spend comparable time on a miss so response timing does not leak
    // whether the address exists.
    await verifyPassword(input.password, 'scrypt$32768$8$1$AAAA$AAAA')
    logger.warn('login failed: unknown email', { email: input.email, ip })
    throw generic
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    logger.warn('login failed: bad password', { userId: user.id, ip })
    throw generic
  }

  if (!user.isActive) {
    throw new AppError('This account has been deactivated. Contact an administrator.', 403, 'ACCOUNT_DISABLED')
  }

  resetRateLimit(`login:email:${input.email}`)
  await pruneExpiredSessions()
  await createSession(user)
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))
  await recordAudit({
    entityType: 'User', entityId: user.id, action: 'LOGIN',
    summary: `${user.name} signed in`, actorId: user.id, ipAddress: ip,
  })
  logger.info('login succeeded', { userId: user.id, role: user.role })
}

export async function logout(userId: string, userName: string): Promise<void> {
  await recordAudit({
    entityType: 'User', entityId: userId, action: 'LOGOUT',
    summary: `${userName} signed out`, actorId: userId, ipAddress: clientIp(),
  })
  await destroySession()
}

/**
 * Change the signed-in user's password.
 *
 * Bumping `tokenVersion` invalidates every session issued before the change,
 * which is the correct behaviour if the old password was compromised.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  const user = rows[0]
  if (!user) throw new UnauthorizedError()

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ValidationError('Your current password is not correct.', { currentPassword: 'Incorrect password.' })
  }

  const strength = assessPassword(newPassword, [user.email, user.name])
  if (!strength.valid) {
    throw new ValidationError(strength.problems[0]!, { newPassword: strength.problems[0]! })
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new ValidationError('Choose a password you have not used before.', {
      newPassword: 'This is your current password.',
    })
  }

  await withTransaction(async () => {
    await db.update(users)
      .set({ passwordHash: await hashPassword(newPassword), tokenVersion: user.tokenVersion + 1, updatedAt: new Date() })
      .where(eq(users.id, userId))
    await recordAudit({
      entityType: 'User', entityId: userId, action: 'PASSWORD_CHANGE',
      summary: `${user.name} changed their password`, actorId: userId, ipAddress: clientIp(),
    })
  })

  await revokeAllSessions(userId)
  logger.info('password changed', { userId })
}

/** Preferences row, created lazily on first read. */
export async function getPreferences(userId: string) {
  const rows = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1)
  if (rows[0]) return rows[0]
  await db.insert(userPreferences).values({ userId }).onConflictDoNothing()
  const created = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1)
  return created[0]!
}
