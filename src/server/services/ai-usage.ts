import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { aiUsage } from '../db/schema'
import { newId } from '@/lib/ids'
import { logger } from '@/lib/logger'
import { costMicros, type Micros } from '@/lib/ai-pricing'
import { businessToday, startOfMonthUtc } from '@/lib/dates'

/**
 * What the AI has cost, and whether it may cost any more this month.
 *
 * Two jobs that belong together because the second is answered from the
 * first: the ceiling is only meaningful if the spending is counted, and
 * counting it is only worth doing if something acts on the total.
 *
 * Nothing here is allowed to break a reading. A failure to write a usage row
 * must not fail the upload it was describing — the accounting is in service
 * of the feature, not the other way round.
 */

/** The features that spend. Named rather than free text so a report can group. */
export const AI_FEATURES = ['invoice', 'gap', 'watch-photo', 'xero-screenshot'] as const
export type AiFeature = (typeof AI_FEATURES)[number]

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  invoice: 'Reading invoices',
  gap: 'Filling content gaps',
  'watch-photo': 'Reading watch photographs',
  'xero-screenshot': 'Reading Xero screenshots',
}

/**
 * The first of the month where the shop is.
 *
 * On the business clock for the same reason every report is: Dubai is four
 * hours ahead, so for the first four hours of the first of a month the
 * server is still in the previous one — and a budget that resets on the
 * server's calendar hands back a month's allowance in the small hours of the
 * wrong day.
 */
export function monthStart(now: Date = new Date()): Date {
  const today = businessToday(now)
  return startOfMonthUtc(today.year, today.month)
}

/**
 * Write down what a call cost.
 *
 * Swallows its own failures. A reading that worked must not be reported as
 * broken because the row describing it could not be written, and a reading
 * that failed is already being reported for its own reasons.
 */
export async function recordUsage(input: {
  feature: AiFeature
  model: string
  inputTokens?: number
  outputTokens?: number
  ok: boolean
  error?: string | null
  actorId?: string | null
}): Promise<void> {
  const inputTokens = input.inputTokens ?? 0
  const outputTokens = input.outputTokens ?? 0
  try {
    await db.insert(aiUsage).values({
      id: newId('aiu'),
      feature: input.feature,
      model: input.model,
      inputTokens,
      outputTokens,
      costMicros: costMicros(input.model, inputTokens, outputTokens),
      ok: input.ok,
      error: input.error?.slice(0, 300) ?? null,
      actorId: input.actorId ?? null,
    })
  } catch (error) {
    logger.warn('could not record AI usage', {
      feature: input.feature,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export interface FeatureSpend {
  feature: string
  calls: number
  failures: number
  costMicros: Micros
}

export interface SpendSummary {
  since: Date
  calls: number
  failures: number
  costMicros: Micros
  /** True where any call in the window used a model with no published price. */
  unpriced: boolean
  byFeature: FeatureSpend[]
}

/** What has been spent since a moment, and on what. */
export async function spendSince(since: Date): Promise<SpendSummary> {
  const rows = await db.select({
    feature: aiUsage.feature,
    calls: sql<number>`count(*)`.mapWith(Number),
    failures: sql<number>`count(*) FILTER (WHERE NOT ${aiUsage.ok})`.mapWith(Number),
    cost: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)`.mapWith(Number),
    // A call whose model had no price is not a call that cost nothing.
    unpriced: sql<number>`count(*) FILTER (WHERE ${aiUsage.costMicros} IS NULL)`.mapWith(Number),
  })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, since))
    .groupBy(aiUsage.feature)
    .orderBy(desc(sql`coalesce(sum(${aiUsage.costMicros}), 0)`))

  return {
    since,
    calls: rows.reduce((total, row) => total + row.calls, 0),
    failures: rows.reduce((total, row) => total + row.failures, 0),
    costMicros: rows.reduce((total, row) => total + row.cost, 0),
    unpriced: rows.some((row) => row.unpriced > 0),
    byFeature: rows.map((row) => ({
      feature: row.feature,
      calls: row.calls,
      failures: row.failures,
      costMicros: row.cost,
    })),
  }
}

/** The last few calls, for seeing a run of failures rather than a total. */
export async function recentCalls(limit = 12) {
  return db.select({
    id: aiUsage.id,
    feature: aiUsage.feature,
    model: aiUsage.model,
    costMicros: aiUsage.costMicros,
    ok: aiUsage.ok,
    error: aiUsage.error,
    createdAt: aiUsage.createdAt,
  })
    .from(aiUsage)
    .orderBy(desc(aiUsage.createdAt))
    .limit(limit)
}

export interface BudgetState {
  /** Dollars per month, or null where no ceiling is set. */
  limitUsd: number | null
  spentMicros: Micros
  /** False once the month's spending has reached the ceiling. */
  allowed: boolean
}

/**
 * Whether there is room in this month's budget.
 *
 * Read before a call rather than after, so the ceiling stops spending rather
 * than merely recording that it happened. No setting means no ceiling, which
 * is the behaviour everything had before this existed.
 *
 * Deliberately not a hard guarantee. Calls in flight when the limit is
 * reached still complete, and two at once can both pass the check — a budget
 * is a brake, not a lock, and the alternative is a transaction around every
 * reading to save a few cents of overshoot.
 */
export async function budgetState(limitUsd: number | null, now: Date = new Date()): Promise<BudgetState> {
  if (limitUsd === null || !Number.isFinite(limitUsd) || limitUsd <= 0) {
    return { limitUsd: null, spentMicros: 0, allowed: true }
  }
  // Every row, not only the ones that worked. A refusal that read nine
  // thousand tokens of photographs before declining cost exactly as much as
  // one that answered, and a ceiling that ignored it would be counting
  // something other than money. It also keeps this figure in step with the
  // one on the settings page, which was never filtered.
  const [row] = await db.select({
    cost: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)`.mapWith(Number),
  })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, monthStart(now)))

  const spentMicros = row?.cost ?? 0
  return { limitUsd, spentMicros, allowed: spentMicros < limitUsd * 1_000_000 }
}

/**
 * The month's ceiling, as the settings hold it.
 *
 * Blank, absent or unparseable all mean no ceiling — the behaviour
 * everything had before this setting existed. A budget that failed closed
 * because somebody typed a stray character would take the features out
 * without saying why, which is the failure this whole file exists to stop.
 */
export async function configuredBudgetUsd(): Promise<number | null> {
  try {
    const { getSettings } = await import('./settings-service')
    const raw = (await getSettings())['ai.monthlyBudgetUsd']?.trim()
    if (!raw) return null
    const usd = Number(raw)
    return Number.isFinite(usd) && usd > 0 ? usd : null
  } catch (error) {
    logger.warn('could not read the AI budget, proceeding without one', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Whether a feature may spend, with the sentence to say when it may not.
 *
 * One place, so the four readers cannot disagree about what the ceiling
 * means — and so a fifth gets it by calling this rather than by remembering
 * to.
 */
export async function spendingAllowed(): Promise<{ allowed: boolean; reason: string | null }> {
  try {
    const state = await budgetState(await configuredBudgetUsd())
    if (state.allowed) return { allowed: true, reason: null }
    const spent = (state.spentMicros / 1_000_000).toFixed(2)
    return {
      allowed: false,
      reason: `this month's AI budget of $${state.limitUsd?.toFixed(2)} is spent ($${spent} so far) — `
        + 'raise it in Settings, or leave it and this will start again next month',
    }
  } catch (error) {
    // The ceiling failing to be read is not a reason to stop working.
    logger.warn('could not check the AI budget, proceeding', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { allowed: true, reason: null }
  }
}
