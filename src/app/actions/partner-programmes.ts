'use server'

import { revalidatePath } from 'next/cache'
import { getPortalDoor } from '@/server/services/partner-portal-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import {
  addAgent, createProgramme, getProgramme, pickReward, recordProgress,
  setAgentTarget, setProgrammeStatus, setTiers,
} from '@/server/services/partner-programme-service'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { ProgrammeKind, ProgrammeStatus } from '@/lib/enums'

export interface ProgrammeState {
  ok: boolean
  message: string
}

const FAILED: ProgrammeState = { ok: false, message: 'That did not work. Please try again.' }

/**
 * Every write here goes through the portal's own door first.
 *
 * A server action is a route like any other. These ones add people to a
 * company's programme and move the figure that decides whether somebody has
 * won a watch — so without this the passphrase would guard the screens and
 * nothing behind them.
 */
async function insideOrNull(token: string) {
  const door = await getPortalDoor(token)
  if (!door) return null
  if (!await hasPortalPass(token, door.passwordHash, door.passwordSetAt)) return null
  return door
}

function fail(error: unknown, fallback: string): ProgrammeState {
  if (isAppError(error)) return { ok: false, message: error.message }
  logger.error(fallback, { error: (error as Error).message })
  return { ok: false, message: fallback }
}

/**
 * The programme belongs to the company whose door this is.
 *
 * Checked on every write rather than trusted from the form, because a
 * programme id in a payload is a thing anybody can change: without this, a
 * partner holding their own passphrase could record progress against another
 * company's agents by typing a different id.
 */
async function ownsProgramme(partnerId: string, programmeId: string): Promise<boolean> {
  const programme = await getProgramme(programmeId)
  return programme !== null && programme.partnerId === partnerId
}

export async function saveProgrammeAction(
  token: string,
  input: {
    name: string
    kind: ProgrammeKind
    intro: string | null
    periodStart: string
    periodEnd: string
    tiers: Array<{ label: string; thresholdBase: number; rewardCapBase: number }>
  },
): Promise<ProgrammeState & { id?: string }> {
  const door = await insideOrNull(token)
  if (!door) return FAILED
  try {
    const id = await createProgramme({ partnerId: door.id, ...input })
    revalidatePath(`/p/${token}/programme`)
    return { ok: true, message: 'Programme created.', id }
  } catch (error) {
    return fail(error, 'The programme could not be saved.')
  }
}

export async function setTiersAction(
  token: string,
  programmeId: string,
  tiers: Array<{ label: string; thresholdBase: number; rewardCapBase: number }>,
): Promise<ProgrammeState> {
  const door = await insideOrNull(token)
  if (!door || !await ownsProgramme(door.id, programmeId)) return FAILED
  try {
    await setTiers(programmeId, tiers)
    revalidatePath(`/p/${token}/programme`)
    return { ok: true, message: 'Rungs saved.' }
  } catch (error) {
    return fail(error, 'Those rungs could not be saved.')
  }
}

export async function setProgrammeStatusAction(
  token: string,
  programmeId: string,
  status: ProgrammeStatus,
): Promise<ProgrammeState> {
  const door = await insideOrNull(token)
  if (!door || !await ownsProgramme(door.id, programmeId)) return FAILED
  try {
    await setProgrammeStatus(programmeId, status)
    revalidatePath(`/p/${token}/programme`)
    return { ok: true, message: status === 'OPEN' ? 'Programme is running.' : 'Programme closed.' }
  } catch (error) {
    return fail(error, 'That could not be changed.')
  }
}

export async function addAgentAction(
  token: string,
  programmeId: string,
  input: { name: string; email: string | null; targetBase: number | null },
): Promise<ProgrammeState> {
  const door = await insideOrNull(token)
  if (!door || !await ownsProgramme(door.id, programmeId)) return FAILED
  try {
    await addAgent({ partnerId: door.id, programmeId, ...input })
    revalidatePath(`/p/${token}/programme`)
    return { ok: true, message: 'Added. Their own link is on the row.' }
  } catch (error) {
    return fail(error, 'That person could not be added.')
  }
}

export async function setTargetAction(
  token: string,
  programmeId: string,
  goalId: string,
  targetBase: number | null,
): Promise<ProgrammeState> {
  const door = await insideOrNull(token)
  if (!door || !await ownsProgramme(door.id, programmeId)) return FAILED
  try {
    await setAgentTarget(goalId, targetBase)
    revalidatePath(`/p/${token}/programme`)
    return { ok: true, message: 'Target saved.' }
  } catch (error) {
    return fail(error, 'That target could not be saved.')
  }
}

/**
 * Where somebody has got to, as at a date.
 *
 * Alex chose this route: "The partner company updates it ... Each update is
 * dated and logged." The name of whoever is at the keyboard is taken rather
 * than assumed, because the portal has one passphrase for the whole company
 * and "HR" and "Mo on reception" are both true of it.
 */
export async function recordProgressAction(
  token: string,
  programmeId: string,
  input: { goalId: string; asOf: string; amountBase: number; note: string | null; byName: string | null },
): Promise<ProgrammeState> {
  const door = await insideOrNull(token)
  if (!door || !await ownsProgramme(door.id, programmeId)) return FAILED
  try {
    await recordProgress({
      goalId: input.goalId,
      asOf: input.asOf,
      amountBase: input.amountBase,
      note: input.note,
      recordedByName: input.byName,
    })
    revalidatePath(`/p/${token}/programme`)
    return { ok: true, message: 'Recorded.' }
  } catch (error) {
    return fail(error, 'That figure could not be recorded.')
  }
}

/**
 * The agent says what they are working toward.
 *
 * The one write an agent's own link carries, and the only action here that
 * does not go through the company's passphrase — an agent has no passphrase,
 * only their link. It writes nothing about money: the service refuses it
 * once the programme has closed, and a pick holds no stock.
 */
export async function pickRewardAction(
  token: string,
  input: { watchId: string | null; note: string | null },
): Promise<ProgrammeState> {
  try {
    await pickReward({ token, watchId: input.watchId, note: input.note })
    revalidatePath(`/a/${token}`)
    return { ok: true, message: 'Saved. You can change it any time while the programme is running.' }
  } catch (error) {
    return fail(error, 'That could not be saved.')
  }
}
