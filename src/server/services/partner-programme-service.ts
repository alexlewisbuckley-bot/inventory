import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import {
  brands, partnerAgentGoals, partnerAgentPlans, partnerAgentProgress, partnerAgents,
  partnerProgrammes, partnerProgrammeTiers, partners, watches,
} from '../db/schema'
import { newId } from '@/lib/ids'
import { randomBytes } from 'node:crypto'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { ladderFor, standingFor, type Standing, type Tier } from '@/lib/programme'
import type { ProgrammeKind, ProgrammeStatus } from '@/lib/enums'

/**
 * An agent's link, minted the way a session token is.
 *
 * 32 random characters from a 256-bit source, one per person — the same
 * reasoning as a campaign recipient's, and it has to hold for longer: this
 * one is good for a year rather than a fortnight, and somebody's colleague
 * must not be able to guess it from their own.
 */
function newAgentToken(): string {
  return randomBytes(24).toString('base64url').slice(0, 32)
}

/**
 * The incentive programme, from the company's side and the agent's.
 *
 * Alex: "a place the company can add their agents to the portal and assign a
 * goal against them or a target that is tracked and obtained against the
 * prize of their choice."
 *
 * Who may do what here is decided by which door somebody came through, and
 * that is the whole of the security model. A partner's own admin is inside
 * their portal, behind the passphrase, and may add agents and move figures.
 * An agent holds a link to one page — their own — and may do exactly one
 * thing with it: say which watch they are working toward. Neither of them is
 * a user of this system, so neither route goes anywhere near capabilities.
 */

/** Everything the partner's own screen needs about one of its people. */
export interface AgentRow {
  agentId: string
  goalId: string | null
  name: string
  email: string | null
  /** Null until somebody puts them on a programme and a link is minted. */
  token: string | null
  isActive: boolean
  /** Their own figure on a single-target programme; null on a ladder. */
  targetBase: number | null
  /** The newest figure anybody has recorded, and when it was true as at. */
  earnedBase: number
  asOf: string | null
  /** Where that figure puts them. */
  standing: Standing
  /** What they are working toward, if they have said. */
  picked: { watchId: string | null; label: string | null; note: string | null } | null
  /** What they said in January, if they have been asked. */
  plan: AgentPlan | null
}

export interface ProgrammeView {
  id: string
  partnerId: string
  name: string
  kind: ProgrammeKind
  intro: string | null
  periodStart: string
  periodEnd: string
  status: ProgrammeStatus
  tiers: Tier[]
  agents: AgentRow[]
}

/** The tiers of one programme, lowest first. */
async function tiersOf(programmeId: string): Promise<Tier[]> {
  const rows = await db
    .select({
      id: partnerProgrammeTiers.id,
      label: partnerProgrammeTiers.label,
      thresholdBase: partnerProgrammeTiers.thresholdBase,
      rewardCapBase: partnerProgrammeTiers.rewardCapBase,
    })
    .from(partnerProgrammeTiers)
    .where(eq(partnerProgrammeTiers.programmeId, programmeId))
    .orderBy(asc(partnerProgrammeTiers.thresholdBase))
  return rows
}

/**
 * The newest figure for each goal in one query.
 *
 * `DISTINCT ON` rather than a window or a round trip per agent: the progress
 * table is a log, so "where are they now" is always the newest row, and a
 * company with forty agents should not cost forty queries to look at.
 *
 * Ordered by the date it is true as at, then by when it was typed — so a
 * correction entered today for August does not overtake September, and two
 * figures for the same date resolve to the one somebody entered last.
 */
async function latestProgress(programmeId: string): Promise<Map<string, { amountBase: number; asOf: string }>> {
  const rows = await db.execute<{ goal_id: string; amount_base: number; as_of: string }>(sql`
    SELECT DISTINCT ON (p.goal_id) p.goal_id, p.amount_base, p.as_of
    FROM partner_agent_progress p
    JOIN partner_agent_goals g ON g.id = p.goal_id
    WHERE g.programme_id = ${programmeId} AND g.deleted_at IS NULL
    ORDER BY p.goal_id, p.as_of DESC, p.created_at DESC
  `)
  return new Map(
    [...rows].map((row) => [row.goal_id, { amountBase: Number(row.amount_base), asOf: String(row.as_of) }]),
  )
}

/** The plan rows for a programme, by goal, so the board can show them. */
async function plansFor(programmeId: string): Promise<Map<string, AgentPlan>> {
  const rows = await db
    .select({
      goalId: partnerAgentPlans.goalId,
      proposedTargetBase: partnerAgentPlans.proposedTargetBase,
      dealsTarget: partnerAgentPlans.dealsTarget,
      approach: partnerAgentPlans.approach,
      support: partnerAgentPlans.support,
      submittedAt: partnerAgentPlans.submittedAt,
      acceptedAt: partnerAgentPlans.acceptedAt,
    })
    .from(partnerAgentPlans)
    .innerJoin(partnerAgentGoals, eq(partnerAgentGoals.id, partnerAgentPlans.goalId))
    .where(and(
      eq(partnerAgentGoals.programmeId, programmeId),
      isNull(partnerAgentGoals.deletedAt),
    ))
  return new Map(rows.map((row) => [row.goalId, asPlan(row)]))
}

/** One agent's plan, for their own page. */
async function planFor(goalId: string): Promise<AgentPlan | null> {
  const [row] = await db
    .select({
      proposedTargetBase: partnerAgentPlans.proposedTargetBase,
      dealsTarget: partnerAgentPlans.dealsTarget,
      approach: partnerAgentPlans.approach,
      support: partnerAgentPlans.support,
      submittedAt: partnerAgentPlans.submittedAt,
      acceptedAt: partnerAgentPlans.acceptedAt,
    })
    .from(partnerAgentPlans)
    .where(eq(partnerAgentPlans.goalId, goalId))
    .limit(1)
  return row ? asPlan(row) : null
}

function asPlan(row: {
  proposedTargetBase: number | null
  dealsTarget: number | null
  approach: string | null
  support: string | null
  submittedAt: Date | null
  acceptedAt: Date | null
}): AgentPlan {
  return {
    proposedTargetBase: row.proposedTargetBase,
    dealsTarget: row.dealsTarget,
    approach: row.approach,
    support: row.support,
    // Dates out as dates, not objects: these cross to a client component.
    submittedAt: row.submittedAt ? row.submittedAt.toISOString().slice(0, 10) : null,
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString().slice(0, 10) : null,
  }
}

/** One programme, with its rungs and everybody on it. */
export async function getProgramme(programmeId: string): Promise<ProgrammeView | null> {
  const [programme] = await db
    .select()
    .from(partnerProgrammes)
    .where(and(eq(partnerProgrammes.id, programmeId), isNull(partnerProgrammes.deletedAt)))
    .limit(1)
  if (!programme) return null

  const [tiers, progress, plans, rows] = await Promise.all([
    tiersOf(programmeId),
    latestProgress(programmeId),
    plansFor(programmeId),
    db
      .select({
        agentId: partnerAgents.id,
        goalId: partnerAgentGoals.id,
        name: partnerAgents.name,
        email: partnerAgents.email,
        token: partnerAgents.token,
        isActive: partnerAgents.isActive,
        targetBase: partnerAgentGoals.targetBase,
        pickedWatchId: partnerAgentGoals.pickedWatchId,
        pickedNote: partnerAgentGoals.pickedNote,
        brandName: brands.name,
        model: watches.model,
        modelName: watches.modelName,
      })
      .from(partnerAgents)
      /*
       * Left, and from the agent: somebody added to the company but not yet
       * put on this year's programme is a person the screen has to show, or
       * adding them looks like it did nothing.
       */
      .leftJoin(partnerAgentGoals, and(
        eq(partnerAgentGoals.agentId, partnerAgents.id),
        eq(partnerAgentGoals.programmeId, programmeId),
        isNull(partnerAgentGoals.deletedAt),
      ))
      .leftJoin(watches, eq(watches.id, partnerAgentGoals.pickedWatchId))
      .leftJoin(brands, eq(brands.id, watches.brandId))
      .where(and(
        eq(partnerAgents.partnerId, programme.partnerId),
        isNull(partnerAgents.deletedAt),
      ))
      .orderBy(asc(partnerAgents.name)),
  ])

  const agents: AgentRow[] = rows.map((row) => {
    const latest = row.goalId ? progress.get(row.goalId) : undefined
    const earnedBase = latest?.amountBase ?? 0
    const rungs = ladderFor(programme.kind as ProgrammeKind, tiers, {
      targetBase: row.targetBase,
    })
    return {
      agentId: row.agentId,
      goalId: row.goalId,
      name: row.name,
      email: row.email,
      token: row.token,
      isActive: row.isActive,
      targetBase: row.targetBase,
      earnedBase,
      asOf: latest?.asOf ?? null,
      standing: standingFor(earnedBase, rungs),
      picked: row.goalId
        ? {
          watchId: row.pickedWatchId,
          label: row.pickedWatchId
            ? [row.brandName, row.model, row.modelName].filter(Boolean).join(' ')
            : null,
          note: row.pickedNote,
        }
        : null,
      plan: row.goalId ? plans.get(row.goalId) ?? null : null,
    }
  })

  return {
    id: programme.id,
    partnerId: programme.partnerId,
    name: programme.name,
    kind: programme.kind as ProgrammeKind,
    intro: programme.intro,
    periodStart: String(programme.periodStart),
    periodEnd: String(programme.periodEnd),
    status: programme.status as ProgrammeStatus,
    tiers,
    agents,
  }
}

/** Every programme a partner has run, newest first. */
export async function listProgrammes(partnerId: string) {
  return db
    .select({
      id: partnerProgrammes.id,
      name: partnerProgrammes.name,
      kind: partnerProgrammes.kind,
      status: partnerProgrammes.status,
      periodStart: partnerProgrammes.periodStart,
      periodEnd: partnerProgrammes.periodEnd,
      agentCount: sql<number>`(
        SELECT count(*)::int FROM partner_agent_goals g
        WHERE g.programme_id = partner_programmes.id AND g.deleted_at IS NULL
      )`,
    })
    .from(partnerProgrammes)
    .where(and(eq(partnerProgrammes.partnerId, partnerId), isNull(partnerProgrammes.deletedAt)))
    .orderBy(desc(partnerProgrammes.createdAt))
}

export async function createProgramme(input: {
  partnerId: string
  name: string
  kind: ProgrammeKind
  intro?: string | null
  periodStart: string
  periodEnd: string
  tiers: Array<{ label: string; thresholdBase: number; rewardCapBase: number }>
}): Promise<string> {
  const name = input.name.trim()
  if (!name) throw new ValidationError('Give the programme a name.')
  if (input.periodEnd < input.periodStart) {
    throw new ValidationError('The programme cannot end before it starts.')
  }
  /*
   * A ladder with no rungs is a page that says nothing, and an agent told
   * nothing is worse served than one told the scheme is not ready.
   */
  if (input.kind === 'LADDER' && input.tiers.length === 0) {
    throw new ValidationError('A ladder needs at least one rung.')
  }

  const id = newId('prg')
  await withTransaction(async () => {
    await db.insert(partnerProgrammes).values({
      id,
      partnerId: input.partnerId,
      name,
      kind: input.kind,
      intro: input.intro?.trim() || null,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: 'DRAFT',
    })
    await writeTiers(id, input.tiers)
  })
  return id
}

/** Replace a programme's rungs wholesale, which is how the form edits them. */
export async function setTiers(
  programmeId: string,
  tiers: Array<{ label: string; thresholdBase: number; rewardCapBase: number }>,
): Promise<void> {
  await withTransaction(async () => {
    await db.delete(partnerProgrammeTiers)
      .where(eq(partnerProgrammeTiers.programmeId, programmeId))
    await writeTiers(programmeId, tiers)
  })
}

async function writeTiers(
  programmeId: string,
  tiers: Array<{ label: string; thresholdBase: number; rewardCapBase: number }>,
): Promise<void> {
  // Sorted on the way in, so the stored order is the order people read.
  const ordered = [...tiers].sort((a, b) => a.thresholdBase - b.thresholdBase)
  for (const [index, tier] of ordered.entries()) {
    if (tier.thresholdBase < 0 || tier.rewardCapBase < 0) {
      throw new ValidationError('A rung cannot be a negative amount.')
    }
    await db.insert(partnerProgrammeTiers).values({
      id: newId('tir'),
      programmeId,
      label: tier.label.trim() || `Rung ${index + 1}`,
      thresholdBase: tier.thresholdBase,
      rewardCapBase: tier.rewardCapBase,
      sortOrder: index,
    })
  }
}

export async function setProgrammeStatus(programmeId: string, status: ProgrammeStatus): Promise<void> {
  const patch: Record<string, unknown> = { status, updatedAt: new Date() }
  if (status === 'OPEN') patch.openedAt = new Date()
  if (status === 'CLOSED') patch.closedAt = new Date()
  await db.update(partnerProgrammes).set(patch).where(eq(partnerProgrammes.id, programmeId))
}

/**
 * Add somebody at the company, and put them on this programme.
 *
 * One act, because they are the same act from where the company is standing:
 * nobody adds an agent in order to leave them off the scheme. The agent and
 * the goal are separate rows because the agent outlasts the year.
 */
export async function addAgent(input: {
  partnerId: string
  programmeId: string
  name: string
  email?: string | null
  targetBase?: number | null
}): Promise<{ agentId: string; token: string }> {
  const name = input.name.trim()
  if (!name) throw new ValidationError('Give the agent a name.')

  const agentId = newId('agt')
  const token = newAgentToken()
  await withTransaction(async () => {
    await db.insert(partnerAgents).values({
      id: agentId,
      partnerId: input.partnerId,
      name,
      email: input.email?.trim() || null,
      token,
    })
    await db.insert(partnerAgentGoals).values({
      id: newId('gol'),
      programmeId: input.programmeId,
      agentId,
      targetBase: input.targetBase ?? null,
    })
  })
  return { agentId, token }
}

/**
 * Put somebody already at the company on this programme too.
 *
 * And give them a door if they have not got one. The team list is older than
 * this feature — it was built as a leaderboard's cast list, where an agent is
 * a name and a photograph and never signs in anywhere. Enrolling one of those
 * people is the moment they need a page of their own, so the token is minted
 * here rather than left null for somebody to wonder about later.
 */
export async function enrolAgent(input: {
  programmeId: string
  agentId: string
  targetBase?: number | null
}): Promise<string> {
  const id = newId('gol')
  await withTransaction(async () => {
    await db.update(partnerAgents)
      .set({ token: newAgentToken(), updatedAt: new Date() })
      .where(and(eq(partnerAgents.id, input.agentId), isNull(partnerAgents.token)))
    await db.insert(partnerAgentGoals).values({
      id,
      programmeId: input.programmeId,
      agentId: input.agentId,
      targetBase: input.targetBase ?? null,
    }).onConflictDoNothing()
  })
  return id
}

export async function setAgentTarget(goalId: string, targetBase: number | null): Promise<void> {
  if (targetBase !== null && targetBase < 0) {
    throw new ValidationError('A target cannot be less than nothing.')
  }
  await db.update(partnerAgentGoals)
    .set({ targetBase, updatedAt: new Date() })
    .where(eq(partnerAgentGoals.id, goalId))
}

/**
 * Record where somebody has got to, as at a date.
 *
 * Appended, never overwritten. The date is the date the figure is true as
 * at, which is not the date it was typed — a company catching up in March on
 * January and February should end with two rows that each say what they mean,
 * not one row that says March.
 */
export async function recordProgress(input: {
  goalId: string
  asOf: string
  amountBase: number
  note?: string | null
  recordedByName?: string | null
}): Promise<void> {
  if (!Number.isFinite(input.amountBase) || input.amountBase < 0) {
    throw new ValidationError('Enter what they have earned so far.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) {
    throw new ValidationError('Give the date this figure is true as at.')
  }
  const [goal] = await db.select({ id: partnerAgentGoals.id })
    .from(partnerAgentGoals).where(eq(partnerAgentGoals.id, input.goalId)).limit(1)
  if (!goal) throw new NotFoundError('That agent is not on this programme.')

  await db.insert(partnerAgentProgress).values({
    id: newId('prg'),
    goalId: input.goalId,
    asOf: input.asOf,
    amountBase: Math.round(input.amountBase),
    note: input.note?.trim() || null,
    recordedVia: 'PORTAL',
    recordedByName: input.recordedByName?.trim() || null,
  })
}

/** Every figure ever recorded against one goal, newest first. */
export async function progressHistory(goalId: string) {
  return db
    .select({
      id: partnerAgentProgress.id,
      asOf: partnerAgentProgress.asOf,
      amountBase: partnerAgentProgress.amountBase,
      note: partnerAgentProgress.note,
      recordedByName: partnerAgentProgress.recordedByName,
      createdAt: partnerAgentProgress.createdAt,
    })
    .from(partnerAgentProgress)
    .where(eq(partnerAgentProgress.goalId, goalId))
    .orderBy(desc(partnerAgentProgress.asOf), desc(partnerAgentProgress.createdAt))
}

/* ------------------------------------------------------------------ *
 * The agent's own door.
 * ------------------------------------------------------------------ */

/**
 * The start-of-year survey, as both screens read it.
 *
 * `proposedTargetBase` is the agent's own figure and nothing else: it does
 * not move the scheme until somebody at the company accepts it, and
 * `acceptedAt` is how you tell which happened.
 */
export interface AgentPlan {
  proposedTargetBase: number | null
  dealsTarget: number | null
  approach: string | null
  support: string | null
  submittedAt: string | null
  acceptedAt: string | null
}

export interface AgentView {
  agentName: string
  partnerName: string
  hasLogo: boolean
  brandColor: string
  accentColor: string
  programmeName: string
  intro: string | null
  periodStart: string
  periodEnd: string
  status: ProgrammeStatus
  goalId: string
  earnedBase: number
  asOf: string | null
  standing: Standing
  picked: { watchId: string | null; label: string | null; note: string | null }
  /** Their own plan, or null where they have not been asked yet. */
  plan: AgentPlan | null
  /** Every figure recorded, so they can see it move rather than take our word. */
  history: Array<{ asOf: string; amountBase: number; note: string | null }>
}

/**
 * What one agent sees at their own link.
 *
 * The newest live programme they are on. A company running 2026 and 2027 at
 * once is not a case worth a chooser on a page somebody opens from a phone
 * between appointments: the one that is running is the one they mean.
 */
export async function getAgentView(token: string): Promise<AgentView | null> {
  if (!token || token.length < 16) return null

  const [row] = await db
    .select({
      agentId: partnerAgents.id,
      agentName: partnerAgents.name,
      isActive: partnerAgents.isActive,
      partnerName: partners.name,
      displayName: partners.displayName,
      hasLogo: sql<boolean>`${partners.logoData} is not null`,
      brandColor: partners.brandColor,
      accentColor: partners.accentColor,
      goalId: partnerAgentGoals.id,
      targetBase: partnerAgentGoals.targetBase,
      pickedWatchId: partnerAgentGoals.pickedWatchId,
      pickedNote: partnerAgentGoals.pickedNote,
      programmeId: partnerProgrammes.id,
      programmeName: partnerProgrammes.name,
      kind: partnerProgrammes.kind,
      intro: partnerProgrammes.intro,
      periodStart: partnerProgrammes.periodStart,
      periodEnd: partnerProgrammes.periodEnd,
      status: partnerProgrammes.status,
    })
    .from(partnerAgents)
    .innerJoin(partners, eq(partners.id, partnerAgents.partnerId))
    .innerJoin(partnerAgentGoals, and(
      eq(partnerAgentGoals.agentId, partnerAgents.id),
      isNull(partnerAgentGoals.deletedAt),
    ))
    .innerJoin(partnerProgrammes, and(
      eq(partnerProgrammes.id, partnerAgentGoals.programmeId),
      isNull(partnerProgrammes.deletedAt),
    ))
    .where(and(
      eq(partnerAgents.token, token),
      eq(partnerAgents.isActive, true),
      isNull(partnerAgents.deletedAt),
      eq(partners.isActive, true),
      isNull(partners.deletedAt),
    ))
    /*
     * Running first, then the newest. A closed programme still opens — an
     * agent coming back in January to see what they finished on is a fair
     * thing to want — but it never hides one that is live.
     */
    .orderBy(
      sql`case when ${partnerProgrammes.status} = 'OPEN' then 0 else 1 end`,
      desc(partnerProgrammes.periodEnd),
    )
    .limit(1)
  if (!row) return null

  const [tiers, history, plan] = await Promise.all([
    tiersOf(row.programmeId),
    progressHistory(row.goalId),
    planFor(row.goalId),
  ])
  const latest = history[0]
  const earnedBase = latest?.amountBase ?? 0
  const rungs = ladderFor(row.kind as ProgrammeKind, tiers, { targetBase: row.targetBase })

  let label: string | null = null
  if (row.pickedWatchId) {
    const [picked] = await db
      .select({ brandName: brands.name, model: watches.model, modelName: watches.modelName })
      .from(watches).innerJoin(brands, eq(brands.id, watches.brandId))
      .where(eq(watches.id, row.pickedWatchId)).limit(1)
    label = picked ? [picked.brandName, picked.model, picked.modelName].filter(Boolean).join(' ') : null
  }

  return {
    agentName: row.agentName,
    partnerName: row.displayName ?? row.partnerName,
    hasLogo: row.hasLogo,
    brandColor: row.brandColor,
    accentColor: row.accentColor,
    programmeName: row.programmeName,
    intro: row.intro,
    periodStart: String(row.periodStart),
    periodEnd: String(row.periodEnd),
    status: row.status as ProgrammeStatus,
    goalId: row.goalId,
    earnedBase,
    asOf: latest ? String(latest.asOf) : null,
    standing: standingFor(earnedBase, rungs),
    picked: { watchId: row.pickedWatchId, label, note: row.pickedNote },
    plan,
    history: history.map((entry) => ({
      asOf: String(entry.asOf),
      amountBase: entry.amountBase,
      note: entry.note,
    })),
  }
}

/**
 * The agent says what they are working toward.
 *
 * The one write their link carries, and it writes nothing about money. A
 * pick is a nomination: the watch stays on sale to everybody, by the same
 * rule the campaign shortlist follows, because a year of agents aiming at
 * pieces would take the case off the market to give away three.
 *
 * Refused once the programme has closed. Changing your mind about a prize
 * you have already been given is a conversation with the company, not a
 * form.
 */
export async function pickReward(input: {
  token: string
  watchId: string | null
  note: string | null
}): Promise<void> {
  const view = await getAgentView(input.token)
  if (!view) throw new NotFoundError('Agent')
  if (view.status !== 'OPEN') {
    throw new ConflictError('This programme is not running, so the choice cannot be changed.')
  }

  if (input.watchId) {
    const [watch] = await db
      .select({ id: watches.id })
      .from(watches)
      .where(and(eq(watches.id, input.watchId), isNull(watches.deletedAt)))
      .limit(1)
    if (!watch) throw new NotFoundError('Watch')
  }

  await db.update(partnerAgentGoals)
    .set({
      pickedWatchId: input.watchId,
      pickedNote: input.note?.trim() || null,
      pickedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(partnerAgentGoals.id, view.goalId))
}

/**
 * The agent fills in the survey.
 *
 * Alex asked for this as a start-of-year thing: "agents to set their targets
 * at the start of the year and have a plan against obtaining it." So it is
 * the agent's own write, on their own link, and it is deliberately not the
 * target. Their figure goes in `proposedTargetBase`; the company's stays on
 * the goal until somebody there accepts theirs. A scheme where the person
 * being measured sets the measure, with nobody told, is not a scheme — and
 * one where their January plan is invisible to the company is a form filled
 * in for nothing.
 *
 * Amendable while the programme runs, because a plan written in January that
 * cannot be corrected in February is a plan people stop writing. Refused once
 * it has closed: the year's figures are in by then and a target changed after
 * the fact rewrites what happened.
 */
export async function savePlan(input: {
  token: string
  proposedTargetBase: number | null
  dealsTarget: number | null
  approach: string | null
  support: string | null
}): Promise<void> {
  const view = await getAgentView(input.token)
  if (!view) throw new NotFoundError('Agent')
  if (view.status !== 'OPEN') {
    throw new ConflictError('This programme is not running, so the plan cannot be changed.')
  }
  if (input.proposedTargetBase !== null && input.proposedTargetBase < 0) {
    throw new ValidationError('A target cannot be less than nothing.')
  }
  if (input.dealsTarget !== null && (input.dealsTarget < 0 || !Number.isInteger(input.dealsTarget))) {
    throw new ValidationError('Give the number of deals as a whole number.')
  }

  const values = {
    proposedTargetBase: input.proposedTargetBase,
    dealsTarget: input.dealsTarget,
    approach: input.approach?.trim() || null,
    support: input.support?.trim() || null,
    submittedAt: new Date(),
    updatedAt: new Date(),
  }
  await db.insert(partnerAgentPlans)
    .values({ id: newId('pln'), goalId: view.goalId, ...values })
    /*
     * Amended rather than added to. `acceptedAt` is left alone on purpose: a
     * figure the company accepted in January stays accepted, and an agent
     * editing their plan afterwards cannot quietly un-accept it to put a
     * different number in its place.
     */
    .onConflictDoUpdate({ target: partnerAgentPlans.goalId, set: values })
}

/**
 * The company takes the agent's figure as the target.
 *
 * Both halves of what Alex asked for: the agent sets their own target, and
 * the company still decides. One act, so the figure on the scheme and the
 * figure in the survey cannot drift apart by somebody retyping it.
 */
export async function acceptPlan(goalId: string): Promise<void> {
  const [plan] = await db
    .select({ proposedTargetBase: partnerAgentPlans.proposedTargetBase })
    .from(partnerAgentPlans)
    .where(eq(partnerAgentPlans.goalId, goalId))
    .limit(1)
  if (!plan) throw new NotFoundError('Plan')
  if (plan.proposedTargetBase === null) {
    throw new ValidationError('They have not put a figure down to accept.')
  }

  await withTransaction(async () => {
    await db.update(partnerAgentGoals)
      .set({ targetBase: plan.proposedTargetBase, updatedAt: new Date() })
      .where(eq(partnerAgentGoals.id, goalId))
    await db.update(partnerAgentPlans)
      .set({ acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(partnerAgentPlans.goalId, goalId))
  })
}
