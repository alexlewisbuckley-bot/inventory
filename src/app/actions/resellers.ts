'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import {
  createReseller, updateReseller, deleteReseller, rotateResellerToken,
  setResellerLogo, assertLogoAcceptable,
} from '@/server/services/reseller-service'
import { resellerSchema, fieldErrors } from '@/lib/validation'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { ActionState } from './auth'

function toState(error: unknown, fallback: string): ActionState {
  if (isAppError(error)) {
    return { ok: false, message: error.message, errors: error.details as Record<string, string> | undefined }
  }
  logger.error(fallback, { error: (error as Error).message })
  return { ok: false, message: fallback }
}

export async function saveResellerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('reseller:manage')
  const id = formData.get('id')?.toString() || null
  const parsed = resellerSchema.safeParse({
    name: formData.get('name'),
    displayName: formData.get('displayName'),
    headline: formData.get('headline'),
    intro: formData.get('intro'),
    contactName: formData.get('contactName'),
    contactEmail: formData.get('contactEmail'),
    contactPhone: formData.get('contactPhone'),
    website: formData.get('website'),
    brandColor: formData.get('brandColor') || undefined,
    accentColor: formData.get('accentColor') || undefined,
    displayCurrency: formData.get('displayCurrency') || undefined,
    notes: formData.get('notes'),
    isActive: formData.get('isActive') === 'on' || formData.get('isActive') === 'true',
  })
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    if (id) await updateReseller(id, parsed.data, actor)
    else await createReseller(parsed.data, actor)
    revalidatePath('/resellers')
    return { ok: true, message: id ? 'Reseller updated.' : 'Reseller added.' }
  } catch (error) {
    return toState(error, 'Could not save the reseller.')
  }
}

export async function deleteResellerAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('reseller:manage')
  try {
    await deleteReseller(id, actor)
    revalidatePath('/resellers')
    return { ok: true, message: 'Reseller removed, and their link stopped working.' }
  } catch (error) {
    return toState(error, 'Could not remove the reseller.')
  }
}

/**
 * Reissue the shop link.
 *
 * The only way to take back a URL that has gone somewhere it should not have.
 * Returns the new token so the page can show the new link straight away rather
 * than leaving the user to guess whether it worked.
 */
export async function rotateResellerTokenAction(id: string): Promise<ActionState & { token?: string }> {
  const actor = await requireCapability('reseller:manage')
  try {
    const token = await rotateResellerToken(id, actor)
    revalidatePath('/resellers')
    return { ok: true, token, message: 'New link issued. The previous one no longer works.' }
  } catch (error) {
    return toState(error, 'Could not reissue the link.')
  }
}

export async function uploadResellerLogoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('reseller:manage')
  const id = formData.get('id')?.toString()
  if (!id) return { ok: false, message: 'No reseller was named.' }

  const file = formData.get('logo')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose a logo file first.' }
  }

  try {
    assertLogoAcceptable(file.type, file.size)
    const data = Buffer.from(await file.arrayBuffer())
    await setResellerLogo(id, { data, mimeType: file.type }, actor)
    revalidatePath('/resellers')
    return { ok: true, message: 'Logo updated.' }
  } catch (error) {
    return toState(error, 'Could not save that logo.')
  }
}

export async function removeResellerLogoAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('reseller:manage')
  try {
    await setResellerLogo(id, null, actor)
    revalidatePath('/resellers')
    return { ok: true, message: 'Logo removed.' }
  } catch (error) {
    return toState(error, 'Could not remove the logo.')
  }
}
