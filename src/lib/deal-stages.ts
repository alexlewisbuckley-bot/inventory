import { DEAL_STAGES, type DealStage } from './enums'

/**
 * How long a deal spent where.
 *
 * Kept as a pure function, away from the database and away from React, because
 * the interesting cases are all data shapes rather than screens: a deal that
 * skipped four stages, one that went backwards from Negotiation to Qualified,
 * one seeded straight into Payment pending with no events at all, and one
 * whose events arrived out of order. Each of those is a unit test below the
 * page; none of them is comfortable to reproduce by clicking.
 *
 * The number this produces is the one that answers "why has this been sitting
 * there?", which is the only question a pipeline gets asked that a board of
 * cards cannot answer.
 */

export interface StageEvent {
  fromStage: DealStage | null
  toStage: DealStage
  at: Date
}

export interface StageVisit {
  stage: DealStage
  enteredAt: Date
  /** Null while the deal is still in this stage. */
  leftAt: Date | null
  ms: number
  /**
   * True when no event recorded this move.
   *
   * Happens with data written before stage events existed, and with anything
   * seeded directly. Marked rather than hidden: an inferred duration is a
   * guess, and a guess presented as a measurement is worse than no number.
   */
  inferred: boolean
}

export interface StageHistory {
  visits: StageVisit[]
  /** Total time in each stage, summed across repeat visits. */
  dwellByStage: Partial<Record<DealStage, number>>
  /** Stages the deal has actually been in, in the order first reached. */
  reached: DealStage[]
  /** How long the deal has existed, in total. */
  ageMs: number
  /** How long it has been sitting in the stage it is in now. */
  currentMs: number
}

/**
 * Rebuild the stage history from the events, the creation time and where the
 * deal is now.
 *
 * `currentStage` is trusted over the events. If they disagree — a move made
 * before events were recorded — the last visit is corrected to the truth and
 * marked inferred, rather than the rail quietly showing a stage the deal left
 * a month ago.
 */
export function stageHistory({ createdAt, events, currentStage, now = new Date() }: {
  createdAt: Date
  events: StageEvent[]
  currentStage: DealStage
  now?: Date
}): StageHistory {
  const start = createdAt.getTime()
  const end = Math.max(now.getTime(), start)

  // Sorted and clamped. An event stamped before the deal existed is a clock
  // problem, not a negative duration, and treating it as one would make the
  // rail show "-3 days" to somebody who then stops believing the rest of it.
  const ordered = [...events]
    .map((event) => ({ ...event, ms: Math.min(Math.max(event.at.getTime(), start), end) }))
    .sort((a, b) => a.ms - b.ms)

  const initial = ordered[0]?.fromStage ?? currentStage
  const visits: StageVisit[] = [{
    stage: initial,
    enteredAt: new Date(start),
    leftAt: null,
    ms: 0,
    inferred: ordered.length === 0,
  }]

  for (const event of ordered) {
    const open = visits[visits.length - 1]!
    // A repeat of the stage already open is not a move. The service refuses to
    // write one, but seeded and imported data can contain them.
    if (open.stage === event.toStage) continue
    open.leftAt = new Date(event.ms)
    open.ms = event.ms - open.enteredAt.getTime()
    visits.push({
      stage: event.toStage,
      enteredAt: new Date(event.ms),
      leftAt: null,
      ms: 0,
      inferred: false,
    })
  }

  const open = visits[visits.length - 1]!
  if (open.stage !== currentStage) {
    // The deal is somewhere no event put it. Believe the deal.
    open.stage = currentStage
    open.inferred = true
  }
  open.ms = end - open.enteredAt.getTime()

  const dwellByStage: Partial<Record<DealStage, number>> = {}
  const reached: DealStage[] = []
  for (const visit of visits) {
    dwellByStage[visit.stage] = (dwellByStage[visit.stage] ?? 0) + visit.ms
    if (!reached.includes(visit.stage)) reached.push(visit.stage)
  }

  return { visits, dwellByStage, reached, ageMs: end - start, currentMs: open.ms }
}

/**
 * Whether a stage sits before, at, or after the current one on the board.
 *
 * Board order, not history: a deal that went backwards is *at* Qualified even
 * though it has been through Negotiation. The rail needs both — this answers
 * where the marker sits, `reached` answers which pips are filled.
 */
export function stagePosition(stage: DealStage, current: DealStage): 'past' | 'current' | 'future' {
  if (stage === current) return 'current'
  return DEAL_STAGES.indexOf(stage) < DEAL_STAGES.indexOf(current) ? 'past' : 'future'
}

/**
 * A duration a person would say out loud.
 *
 * Deliberately coarse. "11 days" is what somebody needs to decide whether to
 * ring; "11 days, 4 hours and 12 minutes" is the same fact wearing a costume,
 * and it makes a column of durations impossible to scan.
 */
export function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'}`
  const weeks = Math.floor(days / 7)
  if (weeks < 9) return `${weeks} weeks`
  const months = Math.floor(days / 30)
  return `${months} ${months === 1 ? 'month' : 'months'}`
}
