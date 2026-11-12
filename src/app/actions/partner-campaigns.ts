'use server'

import { revalidatePath } from 'next/cache'
import { getPortalDoor } from '@/server/services/partner-portal-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import {
  addRecipients, claim, closeCampaign, createCampaign, deleteCampaign, openCampaign,
  removeRecipient, setShortlist, updateCampaign,
} from '@/server/services/partner-campaign-service'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { CampaignKind } from '@/lib/enums'

export interface CampaignState {
  ok: boolean
  message: string
}

const FAILED: CampaignState = { ok: false, message: 'That did not work. Please try again.' }

/**
 * Every campaign action goes through the portal's own door first.
 *
 * A server action is a route like any other, and these change what a company's
 * staff are offered and what stock leaves the market. Without this the
 * passphrase would guard the screens and nothing behind them: anybody holding
 * the link could open a campaign, add themselves to it and claim a watch.
 */
async function insideOrNull(token: string) {
  const door = await getPortalDoor(token)
  if (!door) return null
  if (!await hasPortalPass(token, door.passwordHash, door.passwordSetAt)) return null
  return door
}

function fail(error: unknown, fallback: string): CampaignState {
  if (isAppError(error)) return { ok: false, message: error.message }
  logger.error(fallback, { error: (error as Error).message })
  return { ok: false, message: fallback }
}

export async function saveCampaignAction(
  token: string,
  _previous: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  const door = await insideOrNull(token)
  if (!door) return { ok: false, message: 'Please enter the passphrase again.' }

  const kind = (formData.get('kind')?.toString() ?? 'SHORTLIST') as CampaignKind
  // Typed in whole currency units, held in minor units, converted here and
  // nowhere else — the same rule the rate follows.
  const typed = formData.get('budget')?.toString().replace(/[^\d.]/g, '') ?? ''
  const budgetBase = typed ? Math.round(Number(typed) * 100) : null

  const input = {
    name: formData.get('name')?.toString() ?? '',
    intro: formData.get('intro')?.toString() ?? null,
    kind,
    budgetBase,
  }

  try {
    const id = formData.get('id')?.toString()
    if (id) await updateCampaign(door.id, id, input)
    else await createCampaign(door.id, input)
    revalidatePath(`/p/${token}/campaigns`)
    return { ok: true, message: id ? 'Saved.' : 'Campaign created.' }
  } catch (error) {
    return fail(error, 'That campaign could not be saved.')
  }
}

export async function addRecipientsAction(
  token: string,
  campaignId: string,
  _previous: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  const door = await insideOrNull(token)
  if (!door) return { ok: false, message: 'Please enter the passphrase again.' }

  /*
   * One per line, "Name, email" — because the list already exists in a
   * spreadsheet or an email, and the alternative is somebody filling in a
   * two-field form forty times.
   */
  const people = (formData.get('people')?.toString() ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, email] = line.split(/[,;\t]/)
      return { name: name ?? '', email: email ?? null }
    })

  try {
    const added = await addRecipients(door.id, campaignId, people)
    revalidatePath(`/p/${token}/campaigns`)
    return { ok: true, message: `${added} ${added === 1 ? 'person' : 'people'} added.` }
  } catch (error) {
    return fail(error, 'They could not be added.')
  }
}

export async function removeRecipientAction(
  token: string,
  campaignId: string,
  recipientId: string,
): Promise<CampaignState> {
  const door = await insideOrNull(token)
  if (!door) return { ok: false, message: 'Please enter the passphrase again.' }
  try {
    await removeRecipient(door.id, campaignId, recipientId)
    revalidatePath(`/p/${token}/campaigns`)
    return { ok: true, message: 'Removed.' }
  } catch (error) {
    return fail(error, 'They could not be removed.')
  }
}

export async function setShortlistAction(
  token: string,
  campaignId: string,
  watchIds: string[],
): Promise<CampaignState> {
  const door = await insideOrNull(token)
  if (!door) return { ok: false, message: 'Please enter the passphrase again.' }
  try {
    await setShortlist(door.id, campaignId, watchIds)
    revalidatePath(`/p/${token}/campaigns`)
    return { ok: true, message: 'Shortlist saved.' }
  } catch (error) {
    return fail(error, 'That shortlist could not be saved.')
  }
}

export async function openCampaignAction(token: string, campaignId: string): Promise<CampaignState> {
  const door = await insideOrNull(token)
  if (!door) return { ok: false, message: 'Please enter the passphrase again.' }
  try {
    await openCampaign(door.id, campaignId)
    revalidatePath(`/p/${token}/campaigns`)
    return { ok: true, message: 'Open. Everybody’s link works from now.' }
  } catch (error) {
    return fail(error, 'That campaign could not be opened.')
  }
}

export async function closeCampaignAction(token: string, campaignId: string): Promise<CampaignState> {
  const door = await insideOrNull(token)
  if (!door) return { ok: false, message: 'Please enter the passphrase again.' }
  try {
    await closeCampaign(door.id, campaignId)
    revalidatePath(`/p/${token}/campaigns`)
    return { ok: true, message: 'Closed. Unclaimed links no longer work.' }
  } catch (error) {
    return fail(error, 'That campaign could not be closed.')
  }
}

export async function deleteCampaignAction(token: string, campaignId: string): Promise<CampaignState> {
  const door = await insideOrNull(token)
  if (!door) return { ok: false, message: 'Please enter the passphrase again.' }
  try {
    await deleteCampaign(door.id, campaignId)
    revalidatePath(`/p/${token}/campaigns`)
    return { ok: true, message: 'Removed.' }
  } catch (error) {
    return fail(error, 'That campaign could not be removed.')
  }
}

/**
 * Somebody chooses their watch.
 *
 * No door check here, and none wanted: the recipient's token IS the
 * invitation, and the service refuses anything that is not a live one. What it
 * does check is that the watch was on the list this campaign actually offers,
 * because otherwise a budget campaign is a way to order any watch in the
 * building by editing one hidden field.
 */
export async function claimAction(
  token: string,
  _previous: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  try {
    await claim(
      token,
      formData.get('watchId')?.toString() ?? '',
      formData.get('note')?.toString() ?? null,
    )
    revalidatePath(`/r/${token}`)
    return { ok: true, message: 'Chosen. Somebody will be in touch to arrange it.' }
  } catch (error) {
    return fail(error, FAILED.message)
  }
}
