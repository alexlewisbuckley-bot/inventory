import type { ProgrammeKind } from '@/lib/enums'

/**
 * What a figure means against a ladder.
 *
 * Pure, and tested on its own, because this is the arithmetic the whole
 * feature is about — "if x Million AED earnt unlocks x incetive or watch" —
 * and it is read by three different screens. A rounding or an off-by-one in
 * here is an agent told they have unlocked something they have not.
 */

export interface Tier {
  id: string
  label: string
  /** What has to be earned to reach it, in base minor units. */
  thresholdBase: number
  /** The most a watch chosen against this rung may be worth. */
  rewardCapBase: number
}

export interface Standing {
  /** The rungs, lowest first, each saying whether it is reached. */
  rungs: Array<Tier & { reached: boolean }>
  /** The highest rung reached, or null while still below the first. */
  reached: Tier | null
  /** The next one up, or null once the top is reached. */
  next: Tier | null
  /** What is still to earn to reach `next`, or null when there is no next. */
  toGo: number | null
  /** How far along, 0–1, toward `next` from the rung below it. */
  fraction: number
  /** What they may choose up to right now. Zero until the first rung. */
  capBase: number
}

/**
 * Where an agent stands, given what they have earned.
 *
 * A rung is reached when the figure meets it, not when it passes it: a
 * company that writes "2,000,000" means somebody on exactly two million has
 * done it, and an agent told otherwise would be right to be furious.
 *
 * The fraction is measured from the rung below rather than from zero, so a
 * bar on the agent's page fills across the rung they are climbing instead of
 * creeping for a year. On the first rung the floor is zero, which is the
 * same thing said about a single-target programme.
 */
export function standingFor(earnedBase: number, tiers: Tier[]): Standing {
  const ladder = [...tiers].sort((a, b) => a.thresholdBase - b.thresholdBase)
  const rungs = ladder.map((tier) => ({ ...tier, reached: earnedBase >= tier.thresholdBase }))

  const reached = [...rungs].reverse().find((rung) => rung.reached) ?? null
  const next = rungs.find((rung) => !rung.reached) ?? null

  const floor = reached?.thresholdBase ?? 0
  const toGo = next ? Math.max(0, next.thresholdBase - earnedBase) : null

  /*
   * A span of nothing is a full bar, not a division by zero.
   *
   * Two rungs at the same figure is a company's data entry rather than a
   * state this has to be clever about, and the honest answer for somebody
   * standing on one of them is that the distance to the next is covered.
   */
  const span = next ? next.thresholdBase - floor : 0
  const fraction = next === null
    ? 1
    : span <= 0
      ? 1
      : Math.min(1, Math.max(0, (earnedBase - floor) / span))

  return {
    rungs,
    reached: reached ? { ...reached } : null,
    next: next ? { ...next } : null,
    toGo,
    fraction,
    capBase: reached?.rewardCapBase ?? 0,
  }
}

/**
 * The ladder a single-target programme really is.
 *
 * One rung, at the agent's own figure, unlocking a watch worth up to the cap
 * the company set. Expressed this way so the agent's page, the partner's
 * list and the arithmetic above all read one shape — the alternative is
 * every screen carrying two branches, and the second branch being the one
 * nobody tests.
 */
export function ladderFor(
  kind: ProgrammeKind,
  tiers: Tier[],
  goal: { targetBase: number | null },
): Tier[] {
  if (kind === 'LADDER') return tiers
  if (goal.targetBase === null) return []
  /*
   * The cap comes from the programme's single tier, where there is one.
   *
   * A SINGLE programme stores what the prize may be worth once, as a tier,
   * and each agent's own figure on their goal. Without that row there is
   * nothing to say what they may choose, so the cap is the target itself —
   * which is wrong in the company's favour rather than the agent's, and is
   * visible on the screen rather than silently applied.
   */
  const cap = tiers[0]?.rewardCapBase ?? goal.targetBase
  return [{
    id: tiers[0]?.id ?? 'single',
    label: tiers[0]?.label ?? 'Target',
    thresholdBase: goal.targetBase,
    rewardCapBase: cap,
  }]
}

/** Whether a watch at this price may be chosen against what has been reached. */
export function withinCap(priceBase: number | null, capBase: number): boolean {
  if (priceBase === null) return false
  return capBase > 0 && priceBase <= capBase
}

/**
 * What one deal has to be worth for a plan to add up.
 *
 * The point of asking how many deals is that it turns a wish into
 * arithmetic. "Three million" is a number somebody feels; "three million
 * across ten deals" is three hundred thousand a deal, which is either what
 * they did last year or a conversation worth having in January rather than
 * in November.
 *
 * Rounded down, because a plan that needs 299,999.6 a deal needs 300,000.
 */
export function impliedDeal(proposedTargetBase: number | null, dealsTarget: number | null): number | null {
  if (proposedTargetBase === null || dealsTarget === null) return null
  if (proposedTargetBase <= 0 || dealsTarget <= 0) return null
  return Math.floor(proposedTargetBase / dealsTarget)
}
