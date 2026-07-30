import { DEAL_STAGES, OPEN_DEAL_STAGES, type DealStage } from './enums'

/**
 * The pipeline funnel, computed rather than eyeballed.
 *
 * "How many deals reach each stage, and where do they fall out" sounds like a
 * GROUP BY until the awkward cases arrive: a deal opened straight into
 * Negotiation never generated an Enquiry event but plainly *reached* enquiry's
 * successors; a deal that fell back to Qualified has been in Negotiation and
 * must not be uncounted from it; a lost deal stopped wherever it stopped.
 *
 * The definition used throughout: a deal has **reached** stage S if the
 * furthest stage it has ever been in, in board order, is at or beyond S.
 * Skipped stages count as passed through — the deal got beyond them, which is
 * what a funnel measures. Fallbacks do not uncount — the furthest point is
 * what was achieved.
 *
 * Kept pure and away from the database because every one of those cases is a
 * data shape, and the funnel that quietly gets one wrong produces a conversion
 * rate the owner steers by.
 */

export interface FunnelDeal {
  /** Stages this deal has ever been in: initial, every event's target, current. */
  stages: DealStage[]
  valueGbp: number | null
}

export interface FunnelStep {
  stage: DealStage
  /** Deals that reached this stage or any later one. */
  reached: number
  valueGbp: number
  /** Share of the deals from the previous step that made it here. 1 for the first. */
  conversionFromPrevious: number
  /** Share of everything that entered the funnel. */
  conversionFromTop: number
}

const ORDER = new Map(DEAL_STAGES.map((stage, index) => [stage, index]))

/** The furthest stage a deal has ever been in, in board order. */
export function furthestStage(stages: DealStage[]): DealStage | null {
  let best: DealStage | null = null
  for (const stage of stages) {
    if (!ORDER.has(stage)) continue
    // WON and LOST are outcomes, not rungs: a lost deal's furthest *stage* is
    // wherever it was when it died, so terminal markers are skipped here and
    // reported by winRate instead.
    if (stage === 'WON' || stage === 'LOST') continue
    if (best === null || ORDER.get(stage)! > ORDER.get(best)!) best = stage
  }
  return best
}

/**
 * The funnel over the open stages.
 *
 * A WON deal reached everything: winning means the deal travelled the whole
 * board, whichever stages it happened to skip on the way.
 */
export function funnel(deals: FunnelDeal[]): FunnelStep[] {
  const lastOpen = OPEN_DEAL_STAGES[OPEN_DEAL_STAGES.length - 1]!

  const reachedIndex = deals.map((deal) => {
    if (deal.stages.includes('WON')) return ORDER.get(lastOpen)!
    const furthest = furthestStage(deal.stages)
    return furthest === null ? -1 : ORDER.get(furthest)!
  })

  const steps: FunnelStep[] = []
  let previous = 0

  for (const stage of OPEN_DEAL_STAGES) {
    const index = ORDER.get(stage)!
    let reached = 0
    let valueGbp = 0
    deals.forEach((deal, i) => {
      if (reachedIndex[i]! >= index) {
        reached += 1
        valueGbp += deal.valueGbp ?? 0
      }
    })

    steps.push({
      stage,
      reached,
      valueGbp,
      // 0/0 is "no deals yet", not "0% conversion" — the two read very
      // differently on a screen, so the empty funnel converts at 1.
      conversionFromPrevious: steps.length === 0 ? 1 : (previous === 0 ? 0 : reached / previous),
      conversionFromTop: steps.length === 0
        ? 1
        : (steps[0]!.reached === 0 ? 0 : reached / steps[0]!.reached),
    })
    previous = reached
  }

  return steps
}

export interface WinRate {
  won: number
  lost: number
  /** won / (won + lost), or null when nothing has closed yet. */
  rate: number | null
  wonValueGbp: number
  lostValueGbp: number
}

/**
 * Of the deals that have finished, how many landed.
 *
 * Open deals are excluded entirely rather than counted as not-yet-lost:
 * a pipeline full of new deals would otherwise show a plummeting win rate
 * that recovers as they close, which is a chart of optimism, not outcomes.
 */
export function winRate(deals: Array<{ stage: DealStage; valueGbp: number | null }>): WinRate {
  let won = 0
  let lost = 0
  let wonValueGbp = 0
  let lostValueGbp = 0

  for (const deal of deals) {
    if (deal.stage === 'WON') { won += 1; wonValueGbp += deal.valueGbp ?? 0 }
    if (deal.stage === 'LOST') { lost += 1; lostValueGbp += deal.valueGbp ?? 0 }
  }

  return {
    won,
    lost,
    rate: won + lost === 0 ? null : won / (won + lost),
    wonValueGbp,
    lostValueGbp,
  }
}
