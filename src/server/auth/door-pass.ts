import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'

/**
 * Proof that somebody got past a passphrase on a tokenised door.
 *
 * Not a session. There is no user here and nothing to attribute: somebody
 * outside this business is handed a link and a word, and the only question
 * this answers is whether the browser asking for the page has typed the word
 * for THIS door. So there is no row, nothing to sweep, and nothing to revoke
 * individually — which is the right shape, because what gets revoked in
 * practice is never one browser, it is the passphrase.
 *
 * Signed with the same secret as the staff session, and carrying two things:
 * which door, and a fingerprint of the passphrase that opened it. The
 * fingerprint is what makes changing the passphrase mean something. Without
 * it, somebody given the link in March keeps their cookie for as long as it
 * lasts, and "we changed the passphrase" would be a thing that was true on
 * paper and false in every browser that already had one.
 *
 * Scoped to the one token, so a pass to one door is not a pass to another —
 * they are different companies who should not see each other's access, and a
 * cookie named for the feature rather than the door would hand the second
 * room to whoever got into the first.
 *
 * The mechanism lives here, with the two doors built on it — the reseller
 * trade room and the partner portal — as thin wrappers. It was written for
 * the trade room first; a second copy for the portal is how the three sign-in
 * dances in the browser harnesses drifted apart, one waiting for the wrong
 * event and another hard-coding a path that moved. There is one answer to
 * "has this browser been let in", and both doors get it from the same place.
 */
const ALG = 'HS256'

/** A fortnight: long enough not to be a nuisance, short enough to turn over. */
const MAX_AGE = 14 * 24 * 60 * 60

/**
 * A door: what its cookies are called and which paths they are sent to.
 *
 * The prefix and the path are both part of the scope. Two doors sharing
 * either would be one door wearing two names.
 */
export interface DoorScope {
  /** Cookie name prefix, e.g. `osw_trade`. */
  prefix: string
  /** The route the pass is good for, from the token, e.g. `/t/abc…`. */
  path: (token: string) => string
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET
  if (!value || value.length < 32) {
    throw new Error('AUTH_SECRET must be set to at least 32 characters. See .env.example.')
  }
  return new TextEncoder().encode(value)
}

const cookieName = (scope: DoorScope, token: string): string =>
  // The token itself is not put in a cookie name: it is the secret in the
  // URL, and cookie names turn up in places URLs are not expected to.
  `${scope.prefix}_${createHash('sha256').update(token).digest('hex').slice(0, 16)}`

/**
 * What the passphrase currently is, as a value safe to carry in a cookie.
 *
 * The stored hash already cannot be reversed, and this is a hash of a hash
 * salted by the door it belongs to — so a cookie from one room says nothing
 * about another, and nothing here is a credential even if it leaks.
 */
const fingerprint = (token: string, passwordHash: string, setAt: Date | null): string =>
  createHash('sha256')
    .update(`${token}:${passwordHash}:${setAt?.toISOString() ?? ''}`)
    .digest('base64url')
    .slice(0, 24)

/** Let this browser back in without asking again, until the passphrase moves. */
export async function grantPass(
  scope: DoorScope,
  token: string,
  passwordHash: string,
  setAt: Date | null,
): Promise<void> {
  const jwt = await new SignJWT({ fp: fingerprint(token, passwordHash, setAt) })
    .setProtectedHeader({ alg: ALG })
    .setSubject(token)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + MAX_AGE)
    .sign(secret())

  cookies().set(cookieName(scope, token), jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Strict, not lax: nothing should follow a link from elsewhere straight
    // into somebody's stock, and there is no flow here that needs it.
    sameSite: 'strict',
    path: scope.path(token),
    maxAge: MAX_AGE,
  })
}

/** Whether this browser has already answered for this door. Never throws. */
export async function hasPass(
  scope: DoorScope,
  token: string,
  passwordHash: string,
  setAt: Date | null,
): Promise<boolean> {
  const cookie = cookies().get(cookieName(scope, token))?.value
  if (!cookie) return false
  try {
    const { payload } = await jwtVerify(cookie, secret(), {
      algorithms: [ALG],
      subject: token,
    })
    return payload.fp === fingerprint(token, passwordHash, setAt)
  } catch {
    return false
  }
}

/** Forget this browser's pass — the "not me" on a shared machine. */
export function clearPass(scope: DoorScope, token: string): void {
  cookies().delete({ name: cookieName(scope, token), path: scope.path(token) })
}
