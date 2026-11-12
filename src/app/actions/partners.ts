'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { partnerSchema, fieldErrors } from '@/lib/validation'
import {
  createPartner, deletePartner, updatePartner, setPartnerBrand, setPartnerLogo,
} from '@/server/services/partner-service'
import { proposeBrand, normaliseHex } from '@/server/services/brand-fetch'
import { assertLogoAcceptable } from '@/server/services/reseller-service'
import { closePortal, setPortalAccess } from '@/server/services/partner-portal-service'
import { completeOrder, releaseHold } from '@/server/services/partner-order-service'
import {
  addRecipients, closeCampaign, createCampaign, deleteCampaign, openCampaign,
  removeRecipient, setShortlist, updateCampaign,
} from '@/server/services/partner-campaign-service'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { CampaignKind, CurrencyCode } from '@/lib/enums'
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

/**
 * Open a partner's portal, or change the passphrase on one.
 *
 * The passphrase comes back to the caller exactly once, in the result: it is
 * stored hashed and can never be read again, so the screen that asked for it
 * is the only chance anybody has to copy the link and the word together.
 */
export async function setPortalAccessAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const id = formData.get('id')?.toString() ?? ''
  const passphrase = formData.get('passphrase')?.toString() ?? ''

  try {
    const token = await setPortalAccess(id, passphrase, actor)
    revalidatePath('/partners')
    return { ok: true, message: token }
  } catch (error) {
    return toState(error, 'That portal could not be opened.')
  }
}

export async function closePortalAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  try {
    await closePortal(id, actor)
    revalidatePath('/partners')
    return { ok: true, message: 'Portal closed. That link now opens nothing.' }
  } catch (error) {
    return toState(error, 'That portal could not be closed.')
  }
}

/**
 * Let a held watch go.
 *
 * Behind partner:manage rather than watch:update: releasing a hold is a
 * commercial decision about a company we have an arrangement with, not a
 * stock movement, and the person doing it should be the person who could
 * have agreed the hold in the first place.
 */
export async function releaseHoldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  try {
    await releaseHold(
      formData.get('orderId')?.toString() ?? '',
      formData.get('reason')?.toString() ?? null,
      actor,
    )
    revalidatePath('/partners')
    revalidatePath('/inventory')
    return { ok: true, message: 'Released. The watch is back on the market.' }
  } catch (error) {
    return toState(error, 'That hold could not be released.')
  }
}

/** Close an order that turned into a sale, so it stops reading as waiting. */
export async function completeOrderAction(orderId: string): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  try {
    await completeOrder(orderId, actor)
    revalidatePath('/partners')
    return { ok: true, message: 'Order closed.' }
  } catch (error) {
    return toState(error, 'That order could not be closed.')
  }
}

/*
 * Campaigns, from our side of the counter.
 *
 * The same service the portal uses, behind partner:manage instead of a
 * passphrase. Campaigns were reachable only through a partner's own link to
 * begin with, which meant the people who sell these arrangements could not
 * see one, let alone set one up for a company that would rather we did it.
 * Most will: an estate agency agreeing to reward fifteen staff does not want
 * a login, it wants somebody here to put the list in.
 */
export async function saveCampaignForPartnerAction(
  partnerId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const kind = (formData.get('kind')?.toString() ?? 'SHORTLIST') as CampaignKind
  // Typed in whole currency units, held in minor units, converted here.
  const typed = formData.get('budget')?.toString().replace(/[^\d.]/g, '') ?? ''

  try {
    const input = {
      name: formData.get('name')?.toString() ?? '',
      intro: formData.get('intro')?.toString() ?? null,
      kind,
      budgetBase: typed ? Math.round(Number(typed) * 100) : null,
    }
    const id = formData.get('id')?.toString()
    if (id) await updateCampaign(partnerId, id, input)
    else await createCampaign(partnerId, input)
    revalidatePath(`/partners/${partnerId}`)
    return { ok: true, message: id ? 'Campaign updated.' : 'Campaign created.' }
  } catch (error) {
    return toState(error, 'That campaign could not be saved.')
  }
}

export async function addRecipientsForPartnerAction(
  partnerId: string,
  campaignId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  // One per line, "Name, email" — the list already exists in a spreadsheet or
  // an email, and the alternative is a two-field form filled in forty times.
  const people = (formData.get('people')?.toString() ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, email] = line.split(/[,;\t]/)
      return { name: name ?? '', email: email ?? null }
    })

  try {
    const added = await addRecipients(partnerId, campaignId, people)
    revalidatePath(`/partners/${partnerId}`)
    return { ok: true, message: `${added} added.` }
  } catch (error) {
    return toState(error, 'They could not be added.')
  }
}

export async function removeRecipientForPartnerAction(
  partnerId: string,
  campaignId: string,
  recipientId: string,
): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  try {
    await removeRecipient(partnerId, campaignId, recipientId)
    revalidatePath(`/partners/${partnerId}`)
    return { ok: true, message: 'Removed.' }
  } catch (error) {
    return toState(error, 'They could not be removed.')
  }
}

export async function setShortlistForPartnerAction(
  partnerId: string,
  campaignId: string,
  watchIds: string[],
): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  try {
    await setShortlist(partnerId, campaignId, watchIds)
    revalidatePath(`/partners/${partnerId}`)
    return { ok: true, message: 'Shortlist saved.' }
  } catch (error) {
    return toState(error, 'That shortlist could not be saved.')
  }
}

export async function setCampaignLiveAction(
  partnerId: string,
  campaignId: string,
  live: boolean,
): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  try {
    if (live) await openCampaign(partnerId, campaignId)
    else await closeCampaign(partnerId, campaignId)
    revalidatePath(`/partners/${partnerId}`)
    return {
      ok: true,
      message: live
        ? 'Open. Every link works from now.'
        : 'Closed. Unclaimed links no longer work.',
    }
  } catch (error) {
    return toState(error, 'That campaign could not be changed.')
  }
}

export async function deleteCampaignForPartnerAction(
  partnerId: string,
  campaignId: string,
): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  try {
    await deleteCampaign(partnerId, campaignId)
    revalidatePath(`/partners/${partnerId}`)
    return { ok: true, message: 'Campaign removed.' }
  } catch (error) {
    return toState(error, 'That campaign could not be removed.')
  }
}

/**
 * Look at a partner's website and propose how their portal should look.
 *
 * It proposes and nothing more. The colours and the logo are shown back for a
 * person to accept, because the failure to avoid is a portal that their own
 * staff open to find it quietly the wrong colour — and a parser that liked a
 * stylesheet is not a reason anybody would accept for that.
 *
 * The logo bytes travel back as a data URL rather than being stored on the
 * way past: nothing is written until somebody says yes.
 */
export async function proposeBrandAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  try {
    const proposal = await proposeBrand(formData.get('url')?.toString() ?? '')
    return {
      ok: true,
      message: JSON.stringify({
        sourceUrl: proposal.sourceUrl,
        brandColor: proposal.brandColor,
        accentColor: proposal.accentColor,
        logo: proposal.logo
          ? {
            mimeType: proposal.logo.mimeType,
            dataUrl: `data:${proposal.logo.mimeType};base64,${proposal.logo.data.toString('base64')}`,
          }
          : null,
        notes: proposal.notes,
      }),
    }
  } catch (error) {
    return toState(error, 'That site could not be read.')
  }
}

/** Accept a proposal, or a pair of colours typed by hand. */
export async function savePartnerBrandAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const id = formData.get('id')?.toString() ?? ''
  const brandColor = normaliseHex(formData.get('brandColor')?.toString())
  const accentColor = normaliseHex(formData.get('accentColor')?.toString())
  if (!brandColor || !accentColor) {
    return { ok: false, message: 'Those colours are not valid hex values.' }
  }

  try {
    await setPartnerBrand(id, {
      brandColor,
      accentColor,
      sourceUrl: formData.get('sourceUrl')?.toString() || null,
    }, actor)

    /*
     * The logo comes through as the data URL the proposal returned.
     *
     * Decoded here rather than refetched from their site: refetching would
     * mean the thing somebody approved and the thing that gets stored are two
     * different requests, and the second could answer differently.
     */
    const dataUrl = formData.get('logoDataUrl')?.toString()
    if (dataUrl) {
      const match = dataUrl.match(/^data:([a-z+/-]+);base64,(.+)$/i)
      if (match) {
        const data = Buffer.from(match[2], 'base64')
        assertLogoAcceptable(match[1], data.byteLength)
        await setPartnerLogo(id, { data, mimeType: match[1] }, actor)
      }
    }

    revalidatePath('/partners')
    revalidatePath(`/partners/${id}`)
    return { ok: true, message: 'Branding saved.' }
  } catch (error) {
    return toState(error, 'That branding could not be saved.')
  }
}

export async function uploadPartnerLogoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const id = formData.get('id')?.toString()
  const file = formData.get('logo')
  if (!id) return { ok: false, message: 'No partner was named.' }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose a logo file first.' }
  }

  try {
    assertLogoAcceptable(file.type, file.size)
    await setPartnerLogo(id, { data: Buffer.from(await file.arrayBuffer()), mimeType: file.type }, actor)
    revalidatePath('/partners')
    revalidatePath(`/partners/${id}`)
    return { ok: true, message: 'Logo updated.' }
  } catch (error) {
    return toState(error, 'Could not save that logo.')
  }
}

export async function removePartnerLogoAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  try {
    await setPartnerLogo(id, null, actor)
    revalidatePath('/partners')
    revalidatePath(`/partners/${id}`)
    return { ok: true, message: 'Logo removed.' }
  } catch (error) {
    return toState(error, 'Could not remove that logo.')
  }
}
