'use server'

import { revalidatePath } from 'next/cache'
import { getPortalDoor, placeOrder } from '@/server/services/partner-portal-service'
import { verifyPassword } from '@/server/auth/password'
import { clearPortalPass, grantPortalPass, hasPortalPass } from '@/server/auth/portal-pass'
import { isAppError } from '@/lib/errors'
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
 * the internet can post to, so the things that keep it honest are the same
 * three that keep the trade room honest: one answer for a wrong passphrase
 * and a link that does not exist, scrypt doing work on every attempt, and the
 * two cases taking about as long as each other so the difference cannot be
 * read off a stopwatch.
 */
export async function enterPortalAction(
  token: string,
  _previous: GateState,
  formData: FormData,
): Promise<GateState> {
  const wrong: GateState = { ok: false, message: 'That passphrase was not recognised.' }
  const passphrase = String(formData.get('passphrase') ?? '')

  const door = await getPortalDoor(token)
  if (!door) {
    // The work the real path would have done, so the two take similar time.
    await verifyPassword(passphrase, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA')
    return wrong
  }

  if (!passphrase || !await verifyPassword(passphrase, door.passwordHash)) {
    logger.info('portal refused', { token: token.slice(0, 6) })
    return wrong
  }

  await grantPortalPass(token, door.passwordHash, door.passwordSetAt)
  logger.info('portal entered', { token: token.slice(0, 6) })
  revalidatePath(`/p/${token}`)
  return { ok: true, message: '' }
}

/** Hand the portal back — the "not me" on a borrowed laptop. */
export async function leavePortalAction(token: string): Promise<void> {
  clearPortalPass(token)
  revalidatePath(`/p/${token}`)
}

export interface OrderState {
  ok: boolean
  message: string
}

/**
 * Reserve a watch.
 *
 * The pass is checked here and not only on the page. A server action is a
 * route like any other: without this, the passphrase would guard the list and
 * nothing on it, and anybody holding the link could take stock off the market
 * without ever getting through the door.
 */
export async function placeOrderAction(
  token: string,
  _previous: OrderState,
  formData: FormData,
): Promise<OrderState> {
  const door = await getPortalDoor(token)
  if (!door) return { ok: false, message: 'That link is no longer open.' }
  if (!await hasPortalPass(token, door.passwordHash, door.passwordSetAt)) {
    return { ok: false, message: 'Please enter the passphrase again.' }
  }

  const watchId = String(formData.get('watchId') ?? '')
  if (!watchId) return { ok: false, message: 'Pick a watch first.' }

  try {
    await placeOrder(token, {
      watchId,
      placedByName: formData.get('placedByName')?.toString() ?? null,
      placedByEmail: formData.get('placedByEmail')?.toString() ?? null,
      note: formData.get('note')?.toString() ?? null,
    })
    revalidatePath(`/p/${token}`)
    return { ok: true, message: 'Reserved. Somebody will be in touch to settle it.' }
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message }
    logger.error('partner order failed', { error: (error as Error).message })
    return { ok: false, message: 'That could not be reserved. Please try again.' }
  }
}
