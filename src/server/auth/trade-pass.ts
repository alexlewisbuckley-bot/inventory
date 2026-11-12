import { clearPass, grantPass, hasPass, type DoorScope } from './door-pass'

/**
 * The reseller trade room's door.
 *
 * The mechanism — a signed cookie carrying the door and a fingerprint of the
 * passphrase that opened it — is in `door-pass.ts`, shared with the partner
 * portal. What is here is the scope: this cookie prefix, and a pass good for
 * this room's path and no other.
 *
 * The prefix is unchanged from when this file held the whole thing, so every
 * dealer already inside stays inside.
 */
export const TRADE_DOOR: DoorScope = {
  prefix: 'osw_trade',
  path: (token) => `/t/${token}`,
}

/** Let this browser back in without asking again, until the passphrase moves. */
export const grantTradePass = (token: string, passwordHash: string, setAt: Date | null) =>
  grantPass(TRADE_DOOR, token, passwordHash, setAt)

/** Whether this browser has already answered for this door. Never throws. */
export const hasTradePass = (token: string, passwordHash: string, setAt: Date | null) =>
  hasPass(TRADE_DOOR, token, passwordHash, setAt)

/** Forget this browser's pass — the "not me" on a shared machine. */
export const clearTradePass = (token: string) => clearPass(TRADE_DOOR, token)
