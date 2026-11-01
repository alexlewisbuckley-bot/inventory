'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { createCatalogueLink, revokeCatalogueLink } from '@/server/services/catalogue-link-service'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { ActionState } from './auth'

/**
 * Issuing and withdrawing the links we hand the trade.
 *
 * Behind `reseller:manage`, which is the capability for letting somebody
 * outside the business see our stock. Not `catalogue:read` — a trader signed
 * in to the application holds that, and it would let them mint the link that
 * shows our whole book to whoever they liked.
 */

function toState(error: unknown, fallback: string): ActionState {
  if (isAppError(error)) {
    return { ok: false, message: error.message, errors: error.details as Record<string, string> | undefined }
  }
  logger.error(fallback, { error: (error as Error).message })
  return { ok: false, message: fallback }
}

export async function createCatalogueLinkAction(
  label: string,
  showTradePhotos: boolean,
): Promise<ActionState> {
  const actor = await requireCapability('reseller:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  try {
    await createCatalogueLink({ label, showTradePhotos }, actor)
    revalidatePath('/resellers')
    return { ok: true, message: 'Link ready to send.' }
  } catch (error) {
    return toState(error, 'Could not create the link.')
  }
}

export async function revokeCatalogueLinkAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('reseller:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  try {
    await revokeCatalogueLink(id, actor)
    revalidatePath('/resellers')
    return { ok: true, message: 'That link is dead. Anyone holding it now gets nothing.' }
  } catch (error) {
    return toState(error, 'Could not revoke the link.')
  }
}
