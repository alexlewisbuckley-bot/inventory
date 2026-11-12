'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { partnerSchema, fieldErrors } from '@/lib/validation'
import { createPartner, deletePartner, updatePartner } from '@/server/services/partner-service'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { CurrencyCode } from '@/lib/enums'
import type { ActionState } from './auth'

/**
 * Keeping the partner register.
 *
 * Corporates that buy at an agreed rate and run reward campaigns for their
 * staff. Behind partner:manage, which sits with reseller:manage — the other
 * kind of outside organisation this business deals with — and so belongs to
 * managers and the owner.
 */
export async function savePartnerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const parsed = partnerSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }
  const input = parsed.data

  try {
    // The percentage becomes basis points here and nowhere else: one place
    // where what somebody negotiates turns into what prices are worked from.
    const fields = {
      name: input.name,
      displayName: input.displayName,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      website: input.website,
      discountBps: Math.round(input.discountPercent * 100),
      displayCurrency: input.displayCurrency as CurrencyCode,
      brandColor: input.brandColor,
      accentColor: input.accentColor,
      notes: input.notes,
      isActive: input.isActive,
    }

    const id = formData.get('id')?.toString()
    if (id) {
      await updatePartner(id, fields, actor)
    } else {
      await createPartner(fields, actor)
    }
    revalidatePath('/partners')
    return { ok: true, message: id ? 'Partner updated.' : 'Partner added.' }
  } catch (error) {
    return toState(error, 'That partner could not be saved.')
  }
}

export async function deletePartnerAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  try {
    await deletePartner(id, actor)
    revalidatePath('/partners')
    return { ok: true, message: 'Partner removed.' }
  } catch (error) {
    return toState(error, 'That partner could not be removed.')
  }
}

function toState(error: unknown, fallback: string): ActionState {
  if (isAppError(error)) {
    return { ok: false, message: error.message, errors: error.details as Record<string, string> | undefined }
  }
  logger.error(fallback, { error: (error as Error).message })
  return { ok: false, message: fallback }
}
