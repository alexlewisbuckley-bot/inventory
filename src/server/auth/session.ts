import { createHash, randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { and, eq, gt, isNull, lt } from 'drizzle-orm'
import { db } from '../db/client'
import { sessions, users, type User } from '../db/schema'
import { newId } from '@/lib/ids'
import { logger } from '@/lib/logger'
import { UnauthorizedError, ForbiddenError } from '@/lib/errors'
import { can, type Capability } from '@/lib/permissions'
import type { Role } from '@/lib/enums'

/**
 * Session strategy
 *
 * A signed JWT is stored in an httpOnly cookie for cheap stateless reads, but
 * every session also has a database row keyed by a SHA-256 of the token. That
 * gives the best of both: no DB round-trip is required to reject a forged
 * token, while genuine sessions remain individually revocable (sign out other
 * devices, deactivate a user, force logout on password change).
 */

const COOKIE = 'bluecroft_session'
const ALG = 'HS256'

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET
  if (!value || value.length < 32) {
    throw new Error('AUTH_SECRET must be set to at least 32 characters. See .env.example.')
  }
  return new TextEncoder().encode(value)
}

function maxAge(): number {
  return Number(process.env.SESSION_MAX_AGE ?? 604_800)
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export interface SessionUser {
  id: string
  email: string
  name: string
  role: Role
  initials: string
  jobTitle: string | null
}

const toSessionUser = (user: User): SessionUser => ({
  id: user.id, email: user.email, name: user.name,
  role: user.role, initials: user.initials, jobTitle: user.jobTitle,
})

/** Issue a session: persist the row, sign the JWT, set the cookie. */
export async function createSession(user: User): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + maxAge() * 1000)
  const headerList = headers()

  await db.insert(sessions).values({
    id: newId('ses'),
    userId: user.id,
    tokenHash: hashToken(token),
    userAgent: headerList.get('user-agent')?.slice(0, 255) ?? null,
    ipAddress: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    expiresAt,
  })

  const jwt = await new SignJWT({ sub: user.id, tv: user.tokenVersion, tok: token })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret())

  cookies().set(COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAge(),
  })
}

/** Resolve the signed-in user, or null. Never throws. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookie = cookies().get(COOKIE)?.value
  if (!cookie) return null

  try {
    const { payload } = await jwtVerify(cookie, secret(), { algorithms: [ALG] })
    const userId = payload.sub as string
    const token = payload.tok as string
    if (!userId || !token) return null

    const rows = await db
      .select()
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(users.deletedAt),
        eq(users.isActive, true),
      ))
      .limit(1)

    const row = rows[0]
    if (!row) return null
    // A password change bumps tokenVersion, retiring every older token.
    if (row.users.tokenVersion !== payload.tv) return null

    return toSessionUser(row.users)
  } catch {
    return null
  }
}

/** Resolve the signed-in user or throw 401. Use in server actions and routes. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw new UnauthorizedError()
  return user
}

/** Resolve the signed-in user and assert a capability, or throw 401/403. */
export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const user = await requireUser()
  if (!can(user.role, capability)) {
    logger.warn('capability denied', { userId: user.id, role: user.role, capability })
    throw new ForbiddenError(`Your role (${user.role.toLowerCase()}) cannot perform this action.`)
  }
  return user
}

/** Revoke the current session and clear the cookie. */
export async function destroySession(): Promise<void> {
  const cookie = cookies().get(COOKIE)?.value
  if (cookie) {
    try {
      const { payload } = await jwtVerify(cookie, secret(), { algorithms: [ALG] })
      const token = payload.tok as string
      if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
    } catch {
      // A malformed cookie is still cleared below.
    }
  }
  cookies().delete(COOKIE)
}

/** Revoke every session for a user (deactivation, password change, "sign out everywhere"). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}

/** Housekeeping: drop expired rows. Called opportunistically on sign-in. */
export async function pruneExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))
}

export const SESSION_COOKIE = COOKIE
