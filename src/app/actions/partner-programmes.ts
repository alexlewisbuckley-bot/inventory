'use server'

import { revalidatePath } from 'next/cache'
import { getPortalDoor } from '@/server/services/partner-portal-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import {
  acceptPlan, addAgent, createProgramme, enrolAgent, getProgramme, pickReward,
  recordProgress, savePlan, setAgentTarget, setProgrammeStatus, setTiers,
} from '@/server/services/partner-programme-service'
import { db } from '@/server/db/client'
import { partnerAgentGoals, partnerAgents } from '@/server/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
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

/**
 * And that a goal id in a payload belongs to the programme named with it.
 *
 * Without this, owning one programme was enough: a partner inside their own
 * door could pass their own programme id and another company's goal id, and
 * move that company's agent's figure. The programme check reads as if it
 * covers this and does not — it says who owns the programme, not whose goal
 * the id is.
 */
async function ownsGoal(programmeId: string, goalId: string): Promise<boolean> {
  const [goal] = await db
    .select({ id: partnerAgentGoals.id })
    .from(partnerAgentGoals)
    .where(and(
      eq(partnerAgentGoals.id, goalId),
      eq(partnerAgentGoals.programmeId, programmeId),
      isNull(partnerAgentGoals.deletedAt),
    ))
    .limit(1)
  return goal !== undefined
}

/** And that the person named is one of theirs. */
async function ownsAgent(partnerId: string, agentId: string): Promise<boolean> {
  const [agent] = await db
    .select({ id: partnerAgents.id })
    .from(partnerAgents)
    .where(and(
      eq(partnerAgents.id, agentId),
      eq(partnerAgents.partnerId, partnerId),
      isNull(partnerAgents.deletedAt),
    ))
    .limit(1)
  return agent !== undefined
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

/**
 * Put somebody already on the company's team on this programme.
 *
 * The team list is shared with the leaderboards, so the board shows everybody
 * at the company whether or not they are on this year's scheme. Without this,
 * those rows had a target box that saved nothing.
 */
export async function enrolAgentAction(
  token: string,
  programmeId: string,
  agentId: string,
): Promise<ProgrammeState> {
  const door = await insideOrNull(token)
  if (!door || !await ownsProgramme(door.id, programmeId)) return FAILED
  /*
   * And the agent has to be one of theirs. ownsProgramme says the programme
   * is this partner's; it says nothing about whose person this is, and an id
   * typed into a request is not a person at this company.
   */
  if (!await ownsAgent(door.id, agentId)) return FAILED
  try {
    await enrolAgent({ programmeId, agentId })
    revalidatePath(`/p/${token}/programme`)
    return { ok: true, message: 'On the programme. Their own link is on the row.' }
  } catch (error) {
    return fail(error, 'They could not be put on this programme.')
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
  if (!await ownsGoal(programmeId, goalId)) return FAILED
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
  if (!await ownsGoal(programmeId, input.goalId)) return FAILED
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
 * The agent fills in their start-of-year survey.
 *
 * Their link, their write — and no door check, by the same reasoning as the
 * pick: an agent holds no passphrase, only the link they were sent, and the
 * service reads the agent from it rather than taking an id from the payload.
 *
 * It cannot touch the figure they have earned, and the target it writes is a
 * proposal: the company's target does not move until somebody there accepts
 * it, which is a different action behind the portal passphrase.
 */
export async function savePlanAction(
  token: string,
  input: {
    proposedTargetBase: number | null
    dealsTarget: number | null
    approach: string | null
    support: string | null
  },
): Promise<ProgrammeState> {
  try {
    await savePlan({ token, ...input })
    revalidatePath(`/a/${token}`)
    return { ok: true, message: 'Saved. Your company can see it.' }
  } catch (error) {
    return fail(error, 'That could not be saved.')
  }
}

/** The company takes the agent's own figure as their target. */
export async function acceptPlanAction(
  token: string,
  programmeId: string,
  goalId: string,
): Promise<ProgrammeState> {
  const door = await insideOrNull(token)
  if (!door || !await ownsProgramme(door.id, programmeId)) return FAILED
  if (!await ownsGoal(programmeId, goalId)) return FAILED
  try {
    await acceptPlan(goalId)
    revalidatePath(`/p/${token}/programme`)
    return { ok: true, message: 'Their figure is now the target.' }
  } catch (error) {
    return fail(error, 'That figure could not be accepted.')
  }
}

/**
 * The agent says what they are working toward.
 *
 * One of the two writes an agent's own link carries — the survey is the
 * other — and neither goes through the company's passphrase, because an
 * agent has no passphrase, only their link. It writes nothing about money:
 * the service refuses it once the programme has closed, and a pick holds no
 * stock.
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
