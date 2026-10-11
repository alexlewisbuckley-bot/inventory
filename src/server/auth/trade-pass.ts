import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'

/**
 * Proof that somebody got past the trade room's passphrase.
 *
 * Not a session. There is no user here and nothing to attribute: a dealer is
 * handed a link and a passphrase, and the only question this answers is
 * whether the browser asking for the page has typed the passphrase for THIS
 * reseller's door. So there is no row, nothing to sweep, and nothing to
 * revoke individually — which is the right shape, because what gets revoked
 * in practice is never one browser, it is the passphrase.
 *
 * Signed with the same secret as the staff session, and carrying two things:
 * which door, and a fingerprint of the passphrase that opened it. The
 * fingerprint is what makes changing the passphrase mean something. Without
 * it, a dealer who was given the link in March keeps their cookie for as long
 * as it lasts, and "we changed the passphrase" would be a thing that was true
 * on paper and false in every browser that already had one.
 *
 * Scoped to the one token, so a pass to one reseller's room is not a pass to
 * another's — they are different dealers who should not see each other's
 * access, and a cookie named for the feature rather than the door would hand
 * the second room to whoever got into the first.
 */
const ALG = 'HS256'

/** A fortnight: long enough not to be a nuisance, short enough to turn over. */
const MAX_AGE = 14 * 24 * 60 * 60

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET
  if (!value || value.length < 32) {
    throw new Error('AUTH_SECRET must be set to at least 32 characters. See .env.example.')
  }
  return new TextEncoder().encode(value)
}

const cookieName = (token: string): string =>
  // The token itself is not put in a cookie name: it is the secret in the
  // URL, and cookie names turn up in places URLs are not expected to.
  `osw_trade_${createHash('sha256').update(token).digest('hex').slice(0, 16)}`

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
export async function grantTradePass(
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

  cookies().set(cookieName(token), jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Strict, not lax: nothing should follow a link from elsewhere straight
    // into somebody's trade stock, and there is no flow here that needs it.
    sameSite: 'strict',
    path: `/t/${token}`,
    maxAge: MAX_AGE,
  })
}

/** Whether this browser has already answered for this door. Never throws. */
export async function hasTradePass(
  token: string,
  passwordHash: string,
  setAt: Date | null,
): Promise<boolean> {
  const cookie = cookies().get(cookieName(token))?.value
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
export function clearTradePass(token: string): void {
  cookies().delete({ name: cookieName(token), path: `/t/${token}` })
}
