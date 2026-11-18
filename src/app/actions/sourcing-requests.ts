'use server'

import { revalidatePath } from 'next/cache'
import { getPortalDoor } from '@/server/services/partner-portal-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import { askFromAgent, askFromPortal, type AskInput } from '@/server/services/sourcing-requests'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'

export interface AskState {
  ok: boolean
  message: string
}

const FAILED: AskState = { ok: false, message: 'That did not work. Please try again.' }

function fail(error: unknown, fallback: string): AskState {
  if (isAppError(error)) return { ok: false, message: error.message }
  logger.error('sourcing request failed', { error })
  return { ok: false, message: fallback }
}

/**
 * The company asks us to find something, from inside their portal.
 *
 * Behind the passphrase like every other portal write. Worth saying why a
 * sourcing request needs a door at all: without one, anybody holding a
 * partner's link could fill our procurement board with work.
 */
export async function askFromPortalAction(token: string, input: AskInput): Promise<AskState> {
  const door = await getPortalDoor(token)
  if (!door) return FAILED
  if (!await hasPortalPass(token, door.passwordHash, door.passwordSetAt)) return FAILED

  try {
    await askFromPortal(door.id, input)
    revalidatePath(`/p/${token}`)
    return { ok: true, message: 'Asked. We will come back to you on it.' }
  } catch (error) {
    return fail(error, 'That could not be sent.')
  }
}

/**
 * An agent asks, from their own link.
 *
 * No passphrase, by the same reasoning as their other two writes: they hold a
 * link and nothing else. The service reads who they are from the token rather
 * than taking a name from the form, so an ask cannot be filed under somebody
 * else.
 */
export async function askFromAgentAction(token: string, input: AskInput): Promise<AskState> {
  try {
    await askFromAgent(token, input)
    revalidatePath(`/a/${token}`)
    return { ok: true, message: 'Asked. We will look for it.' }
  } catch (error) {
    return fail(error, 'That could not be sent.')
  }
}
