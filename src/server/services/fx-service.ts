import { eq } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { fxRates } from '../db/schema'
import { recordAudit } from './audit'
import { ValidationError } from '@/lib/errors'
import { RATE_SCALE, type RateTable } from '@/lib/currency'
import { BASE_CURRENCY, CURRENCIES, type CurrencyCode } from '@/lib/enums'
import type { SessionUser } from '../auth/session'

export interface FxRateRow {
  code: CurrencyCode
  ratePerGbp: number
  /** Decimal form for display and editing, e.g. 4.88. */
  rate: number
  updatedAt: Date
  updatedByName: string | null
}

/**
 * Current rates as a lookup table.
 *
 * Every page that renders money needs this, so it is a single small query
 * returning a plain object the pure conversion helpers can consume.
 */
export async function getRateTable(): Promise<RateTable> {
  const rows = await db.select({ code: fxRates.code, ratePerGbp: fxRates.ratePerGbp }).from(fxRates)
  const table: RateTable = { [BASE_CURRENCY]: RATE_SCALE }
  for (const row of rows) table[row.code] = row.ratePerGbp
  return table
}

/** Rates with their provenance, for the settings screen. */
export async function listRates(): Promise<FxRateRow[]> {
  const { users } = await import('../db/schema')
  const rows = await db
    .select({
      code: fxRates.code,
      ratePerGbp: fxRates.ratePerGbp,
      updatedAt: fxRates.updatedAt,
      updatedByName: users.name,
    })
    .from(fxRates)
    .leftJoin(users, eq(users.id, fxRates.updatedById))

  const byCode = new Map(rows.map((row) => [row.code, row]))
  // Return every supported currency, even one with no row yet, so the screen
  // can never silently omit a currency the app offers.
  return CURRENCIES.map((code) => {
    const row = byCode.get(code)
    return {
      code,
      ratePerGbp: row?.ratePerGbp ?? (code === BASE_CURRENCY ? RATE_SCALE : 0),
      rate: (row?.ratePerGbp ?? (code === BASE_CURRENCY ? RATE_SCALE : 0)) / RATE_SCALE,
      updatedAt: row?.updatedAt ?? new Date(0),
      updatedByName: row?.updatedByName ?? null,
    }
  })
}

/**
 * Update rates.
 *
 * The base currency is fixed at 1 and cannot be edited — allowing it to change
 * would silently re-scale every stored amount in the system.
 */
export async function updateRates(
  input: Record<string, number>,
  actor: SessionUser,
): Promise<void> {
  const errors: Record<string, string> = {}
  const updates: Array<{ code: CurrencyCode; ratePerGbp: number }> = []

  for (const [code, value] of Object.entries(input)) {
    if (!(CURRENCIES as readonly string[]).includes(code)) continue
    if (code === BASE_CURRENCY) continue
    if (!Number.isFinite(value) || value <= 0) {
      errors[code] = 'Enter a rate greater than zero.'
      continue
    }
    if (value > 100_000) {
      errors[code] = 'That rate looks wrong — please check.'
      continue
    }
    updates.push({ code: code as CurrencyCode, ratePerGbp: Math.round(value * RATE_SCALE) })
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Some rates could not be saved.', errors)
  }
  if (updates.length === 0) return

  const before = await getRateTable()

  await withTransaction(async () => {
    for (const update of updates) {
      await db.insert(fxRates)
        .values({ code: update.code, ratePerGbp: update.ratePerGbp, updatedById: actor.id })
        .onConflictDoUpdate({
          target: fxRates.code,
          set: { ratePerGbp: update.ratePerGbp, updatedAt: new Date(), updatedById: actor.id },
        })
    }

    const changes = Object.fromEntries(
      updates
        .filter((update) => before[update.code] !== update.ratePerGbp)
        .map((update) => [
          update.code,
          { from: (before[update.code] ?? 0) / RATE_SCALE, to: update.ratePerGbp / RATE_SCALE },
        ]),
    )
    if (Object.keys(changes).length > 0) {
      await recordAudit({
        entityType: 'FxRate', entityId: 'global', action: 'UPDATE', actorId: actor.id,
        summary: `${Object.keys(changes).length} exchange rate(s) updated`, changes,
      })
    }
  })
}

/** Ensure the base currency row exists and is exactly 1. */
export async function ensureBaseRate(): Promise<void> {
  await db.insert(fxRates)
    .values({ code: BASE_CURRENCY, ratePerGbp: RATE_SCALE })
    .onConflictDoNothing()
}
