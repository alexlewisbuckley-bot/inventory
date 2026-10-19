import { and, asc, eq, isNull, lte, or, gte } from 'drizzle-orm'
import { db } from '../db/client'
import { overheads } from '../db/schema'
import { OVERHEAD_PER_YEAR, type OverheadCadence } from '@/lib/enums'

/**
 * What one running cost works out at per month.
 *
 * A quarterly bill is charged a third to each month of its quarter and an
 * annual one a twelfth, rather than landing whole in the month the invoice
 * happens to fall. Spreading is what makes twelve months comparable: the
 * alternative puts the whole year's insurance into January and reports that
 * month as a loss and the other eleven as better than they were.
 *
 * A one-off is not spread. It belongs to its month and nowhere else, which
 * is the entire difference between it and the others.
 */
export function monthlyCost(amount: number, cadence: OverheadCadence): number {
  const perYear = OVERHEAD_PER_YEAR[cadence]
  if (perYear === 0) return amount
  return Math.round((amount * perYear) / 12)
}

/**
 * Whether a cost was being paid during a given month.
 *
 * Dates are held as plain dates — a cost starts on a day, not at an instant
 * in a timezone — so they are compared as text in the same `YYYY-MM-DD`
 * shape Postgres returns, which sorts correctly and cannot be shifted by an
 * hour into the previous month.
 */
export function appliesInMonth(
  overhead: { cadence: OverheadCadence; startsOn: string; endsOn: string | null },
  monthStart: string,
  monthEnd: string,
): boolean {
  if (overhead.startsOn > monthEnd) return false
  if (overhead.endsOn !== null && overhead.endsOn < monthStart) return false
  // A one-off is charged to the month it fell in, and to no other.
  if (overhead.cadence === 'ONE_OFF') return overhead.startsOn >= monthStart && overhead.startsOn <= monthEnd
  return true
}

/**
 * How many running costs exist, against how many this month actually charges.
 *
 * The two are not the same number and the gap is where a month quietly looks
 * cheap. A rent recorded as starting next month is a real cost, correctly
 * entered, that this month charges nothing for — and the only sign of it was
 * a dash in a table. Somebody reading a profit figure has no reason to go
 * looking at that table at all.
 */
export async function overheadCoverage(monthStart: string, monthEnd: string) {
  const rows = await db
    .select()
    .from(overheads)
    .where(and(isNull(overheads.deletedAt), eq(overheads.isActive, true)))

  return {
    recorded: rows.length,
    applying: rows.filter((row) => appliesInMonth(row, monthStart, monthEnd)).length,
    /** Entered, but their first month has not come round yet. */
    startingLater: rows
      .filter((row) => row.startsOn > monthEnd)
      .map((row) => ({ name: row.name, startsOn: row.startsOn })),
    /** Entered, and already finished. */
    ended: rows
      .filter((row) => row.endsOn !== null && row.endsOn < monthStart)
      .map((row) => ({ name: row.name, endsOn: row.endsOn as string })),
  }
}

/** Every running cost still on the books, in the order the report lists them. */
export async function listOverheads() {
  return db
    .select()
    .from(overheads)
    .where(isNull(overheads.deletedAt))
    .orderBy(asc(overheads.sortOrder), asc(overheads.category), asc(overheads.name))
}

/**
 * The costs that applied during one month.
 *
 * Filtered in SQL down to the ones whose period overlaps the month at all,
 * then narrowed in TypeScript for the one-off case, which is a rule about
 * the cadence rather than about the dates and reads far better as the one
 * function above than as a third SQL clause nobody can check.
 */
export async function overheadsInMonth(monthStart: string, monthEnd: string) {
  const rows = await db
    .select()
    .from(overheads)
    .where(and(
      isNull(overheads.deletedAt),
      eq(overheads.isActive, true),
      lte(overheads.startsOn, monthEnd),
      or(isNull(overheads.endsOn), gte(overheads.endsOn, monthStart)),
    ))
    .orderBy(asc(overheads.sortOrder), asc(overheads.category), asc(overheads.name))

  return rows
    .filter((row) => appliesInMonth(row, monthStart, monthEnd))
    .map((row) => ({ ...row, monthly: monthlyCost(row.amount, row.cadence) }))
}
