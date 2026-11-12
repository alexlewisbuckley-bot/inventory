import { clearPass, grantPass, hasPass, type DoorScope } from './door-pass'

/**
 * The partner portal's door.
 *
 * Its own prefix and its own path, so a pass to a partner's portal is not a
 * pass to a dealer's trade room and vice versa. They are different companies
 * seeing different things at different prices, and the one thing a shared
 * cookie would do is hand one of them the other's.
 */
export const PORTAL_DOOR: DoorScope = {
  prefix: 'osw_portal',
  path: (token) => `/p/${token}`,
}

/** Let this browser back in without asking again, until the passphrase moves. */
export const grantPortalPass = (token: string, passwordHash: string, setAt: Date | null) =>
  grantPass(PORTAL_DOOR, token, passwordHash, setAt)

/** Whether this browser has already answered for this door. Never throws. */
export const hasPortalPass = (token: string, passwordHash: string, setAt: Date | null) =>
  hasPass(PORTAL_DOOR, token, passwordHash, setAt)

/** Forget this browser's pass — the "not me" on a shared machine. */
export const clearPortalPass = (token: string) => clearPass(PORTAL_DOOR, token)
