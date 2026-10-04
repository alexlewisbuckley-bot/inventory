'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import {
  createReseller, updateReseller, deleteReseller, rotateResellerToken,
  setResellerDomain, setResellerLogo, assertLogoAcceptable,
} from '@/server/services/reseller-service'
import { headers } from 'next/headers'
import { hostOf, ownHosts } from '@/lib/domains'
import { resellerSchema, fieldErrors } from '@/lib/validation'
import { describeDbError, isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { ActionState } from './auth'

function toState(error: unknown, fallback: string): ActionState {
  if (isAppError(error)) {
    return { ok: false, message: error.message, errors: error.details as Record<string, string> | undefined }
  }
  // A constraint the person can do something about, rather than the fallback.
  const described = describeDbError(error)
  if (described) return { ok: false, message: described }
  logger.error(fallback, { error: (error as Error).message })
  return { ok: false, message: fallback }
}

export async function saveResellerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Inside the try, like everything else. A rejected server action shows the
  // user nothing at all — no toast, no message, a button that looks broken —
  // so a session that has lapsed or a role that cannot do this has to come
  // back as a message rather than as a rejection.
  let actor
  try {
    actor = await requireCapability('reseller:manage')
  } catch (error) {
    return toState(error, 'You are not signed in to do that. Refresh the page and try again.')
  }
  const id = formData.get('id')?.toString() || null
  // Collected as parallel label/href rows from the form, dropping any row
  // where either half is blank: a half-filled row is somebody who started
  // typing and thought better of it, not a link.
  const navLinks = [0, 1, 2, 3, 4].map((i) => ({
    label: (formData.get(`navLabel${i}`) ?? '').toString().trim(),
    href: (formData.get(`navHref${i}`) ?? '').toString().trim(),
  })).filter((link) => link.label && link.href)

  const parsed = resellerSchema.safeParse({
    navLinks,
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
  try {
    const actor = await requireCapability('reseller:manage')
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
  try {
    const actor = await requireCapability('reseller:manage')
    const token = await rotateResellerToken(id, actor)
    revalidatePath('/resellers')
    return { ok: true, token, message: 'New link issued. The previous one no longer works.' }
  } catch (error) {
    return toState(error, 'Could not reissue the link.')
  }
}

/**
 * Point a reseller's shop at a hostname of theirs.
 *
 * The hostnames this deployment answers to are taken from the request as well
 * as from configuration, so somebody cannot accidentally hand the application
 * itself to a reseller — on a preview build, on a self-hosted install, or
 * anywhere else the configured list has not been kept up.
 */
export async function setResellerDomainAction(
  id: string, domain: string,
): Promise<ActionState & { domain?: string | null }> {
  try {
    const actor = await requireCapability('reseller:manage')
    const here = hostOf(headers().get('x-forwarded-host') ?? headers().get('host'))
    const saved = await setResellerDomain(
      id, domain, [...ownHosts(process.env.APP_HOSTS), here], actor,
    )
    revalidatePath('/resellers')
    return {
      ok: true,
      domain: saved,
      message: saved
        ? `Pointed at ${saved}. It goes live as soon as the DNS is in place.`
        : 'Domain removed. Their token link still works.',
    }
  } catch (error) {
    return toState(error, 'Could not save that domain.')
  }
}

export async function uploadResellerLogoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = formData.get('id')?.toString()
  if (!id) return { ok: false, message: 'No reseller was named.' }

  const file = formData.get('logo')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose a logo file first.' }
  }

  try {
    const actor = await requireCapability('reseller:manage')
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
  try {
    const actor = await requireCapability('reseller:manage')
    await setResellerLogo(id, null, actor)
    revalidatePath('/resellers')
    return { ok: true, message: 'Logo removed.' }
  } catch (error) {
    return toState(error, 'Could not remove the logo.')
  }
}
