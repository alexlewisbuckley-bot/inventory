'use server'

import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { getPortalDoor } from '@/server/services/partner-portal-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import {
  addAgent, addPrize, createLeaderboard, deleteLeaderboard, removeAgent, removePrize, saveWeek,
  launchLeaderboard, reservePrizeWatch, setAgentPhoto, setLeaderboardPublished, updateAgent,
  updateLeaderboard, updatePrize,
} from '@/server/services/leaderboard-service'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { PRIZE_KINDS, PRIZE_RULES, type PrizeKind, type PrizeRule } from '@/lib/enums'

/**
 * Who is asking, from either side of the counter.
 *
 * A partner comes through their portal door — token and passphrase — and can
 * only ever touch their own boards. Our staff come through a login with the
 * partner capability and name the partner. Both resolve to one partner id,
 * and every service call below checks the board belongs to it.
 */
export type LeaderboardScope =
  | { kind: 'portal'; token: string }
  | { kind: 'staff'; partnerId: string }

export interface LeaderboardState {
  ok: boolean
  message: string
  id?: string
}

async function partnerFor(scope: LeaderboardScope): Promise<string | null> {
  if (scope.kind === 'portal') {
    const door = await getPortalDoor(scope.token)
    if (!door) return null
    if (!await hasPortalPass(scope.token, door.passwordHash, door.passwordSetAt)) return null
    return door.id
  }
  const actor = await requireCapability('partner:manage')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  return scope.partnerId
}

function refresh(scope: LeaderboardScope, partnerId: string, id?: string) {
  if (scope.kind === 'portal') {
    revalidatePath(`/p/${scope.token}/leaderboards`)
    if (id) revalidatePath(`/p/${scope.token}/leaderboards/${id}`)
  } else {
    revalidatePath(`/partners/${partnerId}`)
    if (id) revalidatePath(`/partners/${partnerId}/leaderboards/${id}`)
  }
}

function fail(error: unknown, fallback: string): LeaderboardState {
  if (isAppError(error)) return { ok: false, message: error.message }
  logger.error(fallback, { error: (error as Error).message })
  return { ok: false, message: fallback }
}

const NO_ENTRY: LeaderboardState = { ok: false, message: 'Please sign in again.' }

/** Whole currency units typed into a box, held as minor units. */
function money(value: FormDataEntryValue | null): number | null {
  const typed = value?.toString().replace(/[^\d.]/g, '') ?? ''
  if (!typed) return null
  const n = Number(typed)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

async function fileFrom(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) return null
  return { data: Buffer.from(await value.arrayBuffer()), mimeType: value.type }
}

export async function saveLeaderboardAction(
  scope: LeaderboardScope,
  leaderboardId: string | null,
  _previous: LeaderboardState,
  formData: FormData,
): Promise<LeaderboardState> {
  const partnerId = await partnerFor(scope)
  if (!partnerId) return NO_ENTRY
  const input = {
    name: formData.get('name')?.toString() ?? '',
    intro: formData.get('intro')?.toString() ?? null,
    metricLabel: formData.get('metricLabel')?.toString() ?? null,
    startsOn: formData.get('startsOn')?.toString() ?? '',
    endsOn: formData.get('endsOn')?.toString() ?? '',
  }
  try {
    const id = leaderboardId
      ? (await updateLeaderboard(partnerId, leaderboardId, input), leaderboardId)
      : await createLeaderboard(partnerId, input)
    refresh(scope, partnerId, id)
    return { ok: true, message: leaderboardId ? 'Saved.' : 'Challenge created.', id }
  } catch (error) {
    return fail(error, 'That challenge could not be saved.')
  }
}

export async function publishLeaderboardAction(
  scope: LeaderboardScope, leaderboardId: string, published: boolean,
): Promise<LeaderboardState> {
  const partnerId = await partnerFor(scope)
  if (!partnerId) return NO_ENTRY
  try {
    await setLeaderboardPublished(partnerId, leaderboardId, published)
    refresh(scope, partnerId, leaderboardId)
    return { ok: true, message: published ? 'The share link is live.' : 'The share link is switched off.' }
  } catch (error) {
    return fail(error, 'That could not be changed.')
  }
}

export async function deleteLeaderboardAction(scope: LeaderboardScope, leaderboardId: string): Promise<LeaderboardState> {
  const partnerId = await partnerFor(scope)
  if (!partnerId) return NO_ENTRY
  try {
    await deleteLeaderboard(partnerId, leaderboardId)
    refresh(scope, partnerId)
    return { ok: true, message: 'Challenge deleted.' }
  } catch (error) {
    return fail(error, 'That challenge could not be deleted.')
  }
}

export async function addAgentAction(
  scope: LeaderboardScope,
  leaderboardId: string,
  _previous: LeaderboardState,
  formData: FormData,
): Promise<LeaderboardState> {
  const partnerId = await partnerFor(scope)
  if (!partnerId) return NO_ENTRY
  try {
    await addAgent(partnerId, leaderboardId, {
      name: formData.get('name')?.toString() ?? '',
      subtitle: formData.get('subtitle')?.toString() ?? null,
      photo: await fileFrom(formData.get('photo')),
    })
    refresh(scope, partnerId, leaderboardId)
    return { ok: true, message: 'Agent added.' }
  } catch (error) {
    return fail(error, 'That agent could not be added.')
  }
}

export async function agentPhotoAction(
  scope: LeaderboardScope, leaderboardId: string, agentId: string, formData: FormData,
): Promise<LeaderboardState> {
  const partnerId = await partnerFor(scope)
  if (!partnerId) return NO_ENTRY
  try {
    const photo = await fileFrom(formData.get('photo'))
    if (!photo) return { ok: false, message: 'Choose a photo first.' }
    await setAgentPhoto(partnerId, leaderboardId, agentId, photo)
    refresh(scope, partnerId, leaderboardId)
    return { ok: true, message: 'Photo updated.' }
  } catch (error) {
    return fail(error, 'That photo could not be saved.')
  }
}

export async function removeAgentAction(
  scope: LeaderboardScope, leaderboardId: string, agentId: string,
): Promise<LeaderboardState> {
  const partnerId = await partnerFor(scope)
  if (!partnerId) return NO_ENTRY
  try {
    await removeAgent(partnerId, leaderboardId, agentId)
    refresh(scope, partnerId, leaderboardId)
    return { ok: true, message: 'Agent removed.' }
  } catch (error) {
    return fail(error, 'That agent could not be removed.')
  }
}

function prizeFrom(formData: FormData) {
  const kind = formData.get('kind')?.toString() as PrizeKind
  const rule = formData.get('rule')?.toString() as PrizeRule
  return {
    name: formData.get('name')?.toString() ?? '',
    kind: PRIZE_KINDS.includes(kind) ? kind : 'WATCH' as PrizeKind,
    valueBase: money(formData.get('value')),
    rule: PRIZE_RULES.includes(rule) ? rule : 'RANK' as PrizeRule,
    rank: Number(formData.get('rank')) || null,
    targetBase: money(formData.get('target')),
  }
}

export async function updateAgentAction(
  scope: LeaderboardScope, leaderboardId: string, agentId: string, formData: FormData,
): Promise<LeaderboardState> {
  const partnerId = await partnerFor(scope)
  if (!partnerId) return NO_ENTRY
  try {
    await updateAgent(partnerId, leaderboardId, agentId, {
      name: formData.get('name')?.toString() ?? '',
      subtitle: formData.get('subtitle')?.toString() ?? null,
    })
    const photo = await fileFrom(formData.get('photo'))
    if (photo) await setAgentPhoto(partnerId, leaderboardId, agentId, photo)
    refresh(scope, partnerId, leaderboardId)
    return { ok: true, message: 'Agent updated.' }
  } catch (error) {
    return fail(error, 'That agent could not be updated.')
  }
}

export async function updatePrizeAction(
  scope: LeaderboardScope, leaderboardId: string, prizeId: string, formData: FormData,
): Promise<LeaderboardState> {
  const partnerId = await partnerFor(scope)
  if (!partnerId) return NO_ENTRY
  try {
    await updatePrize(partnerId, leaderboardId, prizeId, prizeFrom(formData))
    refresh(scope, partnerId, leaderboardId)
    return { ok: true, message: 'Prize updated.' }
  } catch (error) {
    return fail(error, 'That prize could not be updated.')
  }
}

export async function addPrizeAction(
  scope: LeaderboardScope,
  leaderboardId: string,
  _previous: LeaderboardState,
  formData: FormData,
): Promise<LeaderboardState> {
  const partnerId = await partnerFor(scope)
  if (!partnerId) return NO_ENTRY
  const kind = formData.get('kind')?.toString() as PrizeKind
  const rule = formData.get('rule')?.toString() as PrizeRule
  try {
    await addPrize(partnerId, leaderboardId, {
      name: formData.get('name')?.toString() ?? '',
      kind: PRIZE_KINDS.includes(kind) ? kind : 'WATCH',
      valueBase: money(formData.get('value')),
      rule: PRIZE_RULES.includes(rule) ? rule : 'RANK',
      rank: Number(formData.get('rank')) || null,
      targetBase: money(formData.get('target')),
    })
    refresh(scope, partnerId, leaderboardId)
    return { ok: true, message: 'Prize added.' }
  } catch (error) {
    return fail(error, 'That prize could not be added.')
  }
}

export async function removePrizeAction(
  scope: LeaderboardScope, leaderboardId: string, prizeId: string,
): Promise<LeaderboardState> {
  const partnerId = await partnerFor(scope)
  if (!partnerId) return NO_ENTRY
  try {
    await removePrize(partnerId, leaderboardId, prizeId)
    refresh(scope, partnerId, leaderboardId)
    return { ok: true, message: 'Prize removed.' }
  } catch (error) {
    return fail(error, 'That prize could not be removed.')
  }
}

export async function saveWeekAction(
  scope: LeaderboardScope,
  leaderboardId: string,
  week: string,
  rows: Array<{ agentId: string; commission: string; deals: string }>,
): Promise<LeaderboardState> {
  const partnerId = await partnerFor(scope)
  if (!partnerId) return NO_ENTRY
  try {
    await saveWeek(partnerId, leaderboardId, week, rows.map((row) => ({
      agentId: row.agentId,
      commissionBase: row.commission.trim() === '' ? null : money(row.commission),
      deals: row.deals.trim() === '' ? null : Number(row.deals),
    })))
    refresh(scope, partnerId, leaderboardId)
    return { ok: true, message: 'Week saved. The board is up to date.' }
  } catch (error) {
    return fail(error, 'Those figures could not be saved.')
  }
}

export async function reservePrizeWatchAction(
  scope: LeaderboardScope,
  leaderboardId: string,
  input: { watchId: string; rule: PrizeRule; rank: number | null; target: string },
): Promise<LeaderboardState> {
  const partnerId = await partnerFor(scope)
  if (!partnerId) return NO_ENTRY
  try {
    await reservePrizeWatch(partnerId, leaderboardId, {
      watchId: input.watchId,
      rule: PRIZE_RULES.includes(input.rule) ? input.rule : 'RANK',
      rank: input.rule === 'RANK' ? input.rank : null,
      targetBase: input.rule === 'TARGET' ? money(input.target) : null,
    })
    refresh(scope, partnerId, leaderboardId)
    if (scope.kind === 'portal') revalidatePath(`/p/${scope.token}`)
    return { ok: true, message: 'Reserved. The watch is on hold for you as a prize.' }
  } catch (error) {
    return fail(error, 'That watch could not be reserved.')
  }
}

export async function launchLeaderboardAction(scope: LeaderboardScope, leaderboardId: string): Promise<LeaderboardState> {
  const partnerId = await partnerFor(scope)
  if (!partnerId) return NO_ENTRY
  try {
    await launchLeaderboard(partnerId, leaderboardId)
    refresh(scope, partnerId, leaderboardId)
    return { ok: true, message: 'Launched. Figures can go in each week, and you can share the board.' }
  } catch (error) {
    return fail(error, 'That challenge could not be launched.')
  }
}
