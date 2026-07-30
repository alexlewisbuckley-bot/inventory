import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { dealStageEvents, deals } from '../db/schema'
import { funnel, winRate, type FunnelDeal, type FunnelStep, type WinRate } from '@/lib/funnel'
import { stageHistory } from '@/lib/deal-stages'
import type { DealStage } from '@/lib/enums'

/**
 * The selling questions, answered from data that already exists.
 *
 * Everything here reads `deals` and `deal_stage_events` — recorded since the
 * CRM shipped, displayed one deal at a time on the stage rail since E3, and
 * never aggregated. The arithmetic itself lives in `src/lib/funnel.ts` and
 * `src/lib/deal-stages.ts` as pure, unit-tested functions; this file's whole
 * job is to feed them and to never re-derive what they already know.
 */

export interface StageDwell {
  stage: DealStage
  /** Mean time spent in the stage across completed visits, in ms. */
  meanMs: number
  visits: number
}

export interface SellingInsights {
  funnel: FunnelStep[]
  winRate: WinRate
  dwell: StageDwell[]
  /** Deals with any recorded history at all, for the "not enough data" state. */
  dealCount: number
}

export async function sellingInsights(): Promise<SellingInsights> {
  const [rows, events] = await Promise.all([
    db.select({
      id: deals.id,
      stage: deals.stage,
      valueGbp: deals.valueGbp,
      createdAt: deals.createdAt,
    })
      .from(deals)
      .where(isNull(deals.deletedAt)),

    db.select({
      dealId: dealStageEvents.dealId,
      fromStage: dealStageEvents.fromStage,
      toStage: dealStageEvents.toStage,
      at: dealStageEvents.createdAt,
    })
      .from(dealStageEvents)
      .orderBy(asc(dealStageEvents.createdAt)),
  ])

  const eventsByDeal = new Map<string, typeof events>()
  for (const event of events) {
    const list = eventsByDeal.get(event.dealId) ?? []
    list.push(event)
    eventsByDeal.set(event.dealId, list)
  }

  // Every stage a deal has ever touched: where its first event started from,
  // everywhere an event took it, and wherever it is now — which covers deals
  // moved before events were recorded.
  const funnelDeals: FunnelDeal[] = rows.map((deal) => {
    const dealEvents = eventsByDeal.get(deal.id) ?? []
    const stages: DealStage[] = []
    const first = dealEvents[0]?.fromStage
    if (first) stages.push(first as DealStage)
    for (const event of dealEvents) stages.push(event.toStage as DealStage)
    stages.push(deal.stage as DealStage)
    return { stages, valueGbp: deal.valueGbp }
  })

  // Dwell reuses the stage-rail arithmetic — one definition of "time in
  // stage" for the record page and the aggregate, or the two disagree and
  // whichever the owner read second looks broken. Only completed visits
  // count: an open deal sitting in Sourcing is not evidence about how long
  // sourcing takes, only about how long this one has taken so far.
  const totals = new Map<DealStage, { ms: number; visits: number }>()
  for (const deal of rows) {
    const history = stageHistory({
      createdAt: deal.createdAt,
      events: (eventsByDeal.get(deal.id) ?? []).map((event) => ({
        fromStage: event.fromStage as DealStage | null,
        toStage: event.toStage as DealStage,
        at: event.at,
      })),
      currentStage: deal.stage as DealStage,
    })
    for (const visit of history.visits) {
      if (visit.leftAt === null || visit.inferred) continue
      // Terminal outcomes are not stages. A deal reopened out of Lost produces
      // a completed "visit" to Lost, and charting how long deals spend being
      // lost is a number with no decision attached to it.
      if (visit.stage === 'WON' || visit.stage === 'LOST') continue
      const entry = totals.get(visit.stage) ?? { ms: 0, visits: 0 }
      entry.ms += visit.ms
      entry.visits += 1
      totals.set(visit.stage, entry)
    }
  }

  const dwell: StageDwell[] = [...totals.entries()]
    .map(([stage, entry]) => ({ stage, meanMs: entry.ms / entry.visits, visits: entry.visits }))
    .sort((a, b) => b.meanMs - a.meanMs)

  return {
    funnel: funnel(funnelDeals),
    winRate: winRate(rows.map((deal) => ({ stage: deal.stage as DealStage, valueGbp: deal.valueGbp }))),
    dwell,
    dealCount: rows.length,
  }
}

/**
 * Why deals die, in their own words.
 *
 * The Lost dialog has insisted on a reason since the board shipped, on the
 * promise that the reasons would be worth something later. This is later.
 */
export async function lostReasons(limit = 6) {
  const rows = await db.select({
    reason: sql<string>`coalesce(nullif(trim(${deals.lostReason}), ''), 'No reason recorded')`,
    count: sql<number>`count(*)`,
    valueGbp: sql<number>`coalesce(sum(${deals.valueGbp}), 0)`,
  })
    .from(deals)
    .where(and(isNull(deals.deletedAt), eq(deals.stage, 'LOST')))
    .groupBy(sql`coalesce(nullif(trim(${deals.lostReason}), ''), 'No reason recorded')`)
    .orderBy(sql`count(*) DESC`)
    .limit(limit)

  return rows.map((row) => ({
    reason: row.reason,
    count: Number(row.count),
    valueGbp: Number(row.valueGbp),
  }))
}
