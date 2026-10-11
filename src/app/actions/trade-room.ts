'use server'

import { revalidatePath } from 'next/cache'
import { getTradeDoor } from '@/server/services/reseller-service'
import { verifyPassword } from '@/server/auth/password'
import { clearTradePass, grantTradePass } from '@/server/auth/trade-pass'
import { logger } from '@/lib/logger'

export interface GateState {
  ok: boolean
  message: string
}

/**
 * The passphrase, checked.
 *
 * Deliberately unauthenticated — there is no session here and the whole point
 * is that there does not need to be one. What that costs is a form anybody on
 * the internet can post to, so the things that keep it honest are:
 *
 *  - the same answer for a wrong passphrase and a token that does not exist,
 *    so this cannot be used to find out which trade links are real;
 *  - scrypt, which is slow on purpose, so guessing is slow too and no rate
 *    limiter has to be the only thing standing in the way;
 *  - a pause before answering, so that "no such room" and "wrong passphrase"
 *    take about as long as each other and the difference between them cannot
 *    be read off a stopwatch.
 */
export async function enterTradeRoomAction(
  token: string,
  _previous: GateState,
  formData: FormData,
): Promise<GateState> {
  const wrong: GateState = { ok: false, message: 'That passphrase was not recognised.' }
  const passphrase = String(formData.get('passphrase') ?? '')

  const door = await getTradeDoor(token)
  if (!door) {
    // The work the real path would have done, so the two take similar time.
    await verifyPassword(passphrase, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA')
    return wrong
  }

  if (!passphrase || !await verifyPassword(passphrase, door.passwordHash)) {
    logger.info('trade room refused', { token: token.slice(0, 6) })
    return wrong
  }

  await grantTradePass(token, door.passwordHash, door.passwordSetAt)
  logger.info('trade room entered', { token: token.slice(0, 6) })
  revalidatePath(`/t/${token}`)
  return { ok: true, message: '' }
}

/** Hand the room back — the "not me" on a borrowed laptop. */
export async function leaveTradeRoomAction(token: string): Promise<void> {
  clearTradePass(token)
  revalidatePath(`/t/${token}`)
}
