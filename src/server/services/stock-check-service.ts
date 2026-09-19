import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, withTransaction } from '../db/client'
import { brands, locations, stockCheckLines, stockChecks, users, watches } from '../db/schema'
import { recordAudit } from './audit'
import { moveWatches } from './watch-service'
import { newId } from '@/lib/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { ACTIVE_STATUSES, type StockCheckLineStatus } from '@/lib/enums'
import type { SessionUser } from '../auth/session'
import { logger } from '@/lib/logger'

/**
 * Counting the stock.
 *
 * The whole system says what should be in the safe; this is the only part that
 * asks whether it is. Three things make it trustworthy rather than merely
 * present:
 *
 * The list is frozen when the check opens. Counting against live stock means a
 * watch sold at three o'clock quietly leaves the list it was being counted
 * against, and the totals never reconcile — which is how a business stops
 * believing its own stock take.
 *
 * Nothing is inferred. A watch nobody looked for is "not counted", which is a
 * different fact from "missing", and only completing the check turns one into
 * the other — deliberately, with the number said out loud first.
 *
 * Missing never writes stock off. Finding that a watch is not where it should
 * be is the beginning of an investigation, not the end of one, and a count
 * that silently changed inventory would be a tool nobody dared run.
 */

// ---------------------------------------------------------------------------
// Starting one
// ---------------------------------------------------------------------------

/** What a check covers: everything held, optionally narrowed to one location. */
export interface StockCheckScope {
  locationId?: string | null
  notes?: string | null
}

const monthDay = (date: Date) =>
  date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })

/**
 * Open a check and snapshot what it expects to find.
 *
 * Refuses a second open check over the same ground. Two people counting one
 * safe into two records produces two different answers and no way to tell
 * which was the stock take.
 */
export async function startStockCheck(scope: StockCheckScope, actor: SessionUser): Promise<string> {
  return withTransaction(async () => {
    let locationName: string | null = null
    if (scope.locationId) {
      const found = await db.select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(and(eq(locations.id, scope.locationId), isNull(locations.deletedAt)))
        .limit(1)
      if (!found[0]) throw new NotFoundError('Location')
      locationName = found[0].name
    }

    const clash = await db.select({ id: stockChecks.id, reference: stockChecks.reference })
      .from(stockChecks)
      .where(and(
        eq(stockChecks.status, 'OPEN'),
        isNull(stockChecks.deletedAt),
        scope.locationId
          ? eq(stockChecks.locationId, scope.locationId)
          : isNull(stockChecks.locationId),
      ))
      .limit(1)
    if (clash[0]) {
      throw new ConflictError(
        `${clash[0].reference} is still open over the same stock. Finish or abandon it before starting another.`,
      )
    }

    // Live stock only. A sold watch is not expected to be in the safe, and
    // putting it on the list would guarantee a "missing" that is not missing.
    const expected = await db.select({
      id: watches.id,
      locationId: watches.locationId,
    })
      .from(watches)
      .where(and(
        isNull(watches.deletedAt),
        inArray(watches.status, [...ACTIVE_STATUSES]),
        scope.locationId ? eq(watches.locationId, scope.locationId) : undefined,
      ))

    if (expected.length === 0) {
      throw new ValidationError(
        locationName
          ? `There is no stock at ${locationName} to count.`
          : 'There is no stock to count.',
      )
    }

    const id = newId('stc')
    const reference = `${locationName ?? 'All stock'} — ${monthDay(new Date())}`

    await db.insert(stockChecks).values({
      id,
      reference,
      locationId: scope.locationId ?? null,
      expectedCount: expected.length,
      notes: scope.notes?.trim() || null,
      startedById: actor.id,
    })

    await db.insert(stockCheckLines).values(expected.map((watch) => ({
      id: newId('scl'),
      checkId: id,
      watchId: watch.id,
      expectedLocationId: watch.locationId,
    })))

    await recordAudit({
      entityType: 'StockCheck', entityId: id, action: 'CREATE', actorId: actor.id,
      summary: `Stock check opened: ${reference}, ${expected.length} expected`,
    })

    logger.info('stock check opened', { id, expected: expected.length, locationId: scope.locationId })
    return id
  })
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

async function openCheck(checkId: string) {
  const rows = await db.select().from(stockChecks).where(eq(stockChecks.id, checkId)).limit(1)
  const check = rows[0]
  if (!check || check.deletedAt) throw new NotFoundError('Stock check')
  if (check.status !== 'OPEN') {
    throw new ValidationError(`${check.reference} is ${check.status.toLowerCase()} and cannot be changed.`)
  }
  return check
}

export interface RecordLineInput {
  status: StockCheckLineStatus
  /** Where it actually was. Turns FOUND into FOUND_ELSEWHERE when it differs. */
  foundLocationId?: string | null
  notes?: string | null
  /** Move the watch to where it was found. Off by default — see below. */
  move?: boolean
}

export interface RecordLineResult {
  lineId: string
  status: StockCheckLineStatus
  stockNo: number
  label: string
  /** Set when the watch was moved to where it was found. */
  movedTo: string | null
}

/**
 * Record what happened to one watch.
 *
 * Finding something in the wrong place does not move it on its own. The person
 * holding the watch knows whether it is going back or staying put, and a count
 * that rearranged the stock record as a side effect of looking would be worse
 * than one that only reports — so the move is asked for, not assumed.
 */
export async function recordLine(
  checkId: string,
  watchId: string,
  input: RecordLineInput,
  actor: SessionUser,
): Promise<RecordLineResult> {
  const check = await openCheck(checkId)

  const rows = await db.select({
    line: stockCheckLines,
    stockNo: watches.stockNo,
    model: watches.model,
    brandName: brands.name,
  })
    .from(stockCheckLines)
    .innerJoin(watches, eq(watches.id, stockCheckLines.watchId))
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .where(and(eq(stockCheckLines.checkId, checkId), eq(stockCheckLines.watchId, watchId)))
    .limit(1)

  const row = rows[0]
  if (!row) throw new NotFoundError('That watch is not on this stock check')

  // Found somewhere other than expected is its own outcome, derived rather
  // than left to whoever is tapping the buttons to classify correctly.
  const elsewhere = input.status === 'FOUND'
    && input.foundLocationId
    && input.foundLocationId !== row.line.expectedLocationId
  const status: StockCheckLineStatus = elsewhere ? 'FOUND_ELSEWHERE' : input.status

  await db.update(stockCheckLines).set({
    status,
    foundLocationId: status === 'FOUND_ELSEWHERE' ? input.foundLocationId ?? null : null,
    notes: input.notes?.trim() || null,
    checkedById: actor.id,
    checkedAt: new Date(),
  }).where(eq(stockCheckLines.id, row.line.id))

  let movedTo: string | null = null
  if (status === 'FOUND_ELSEWHERE' && input.move && input.foundLocationId) {
    await moveWatches([watchId], input.foundLocationId, `Found here during ${check.reference}`, actor)
    const named = await db.select({ name: locations.name }).from(locations)
      .where(eq(locations.id, input.foundLocationId)).limit(1)
    movedTo = named[0]?.name ?? null
  }

  return {
    lineId: row.line.id,
    status,
    stockNo: row.stockNo,
    label: `${row.brandName} ${row.model}`,
    movedTo,
  }
}

export interface ScanResult {
  ok: boolean
  message: string
  line?: RecordLineResult
}

/**
 * Count something by typing or scanning what is written on it.
 *
 * The difference between a usable stock take and a spreadsheet with four
 * hundred tick boxes. Serial first, because that is what is engraved on the
 * back and what a scanner reads; stock number second, because that is what is
 * on the label in the tray.
 *
 * Every outcome answers in a sentence, including the unhappy ones: a watch
 * that is not on this check is a different problem from one already counted,
 * and somebody working through a safe at speed needs to know which.
 */
export async function scanForCheck(
  checkId: string,
  term: string,
  actor: SessionUser,
): Promise<ScanResult> {
  const check = await openCheck(checkId)
  const needle = term.trim()
  if (!needle) return { ok: false, message: 'Type or scan a serial number or a stock number.' }

  const stockNo = /^\d+$/.test(needle) ? Number(needle) : null

  const matches = await db.select({
    watchId: watches.id,
    stockNo: watches.stockNo,
    serial: watches.serial,
    model: watches.model,
    brandName: brands.name,
    lineId: stockCheckLines.id,
    lineStatus: stockCheckLines.status,
  })
    .from(watches)
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .leftJoin(stockCheckLines, and(
      eq(stockCheckLines.watchId, watches.id),
      eq(stockCheckLines.checkId, checkId),
    ))
    .where(and(
      isNull(watches.deletedAt),
      stockNo === null
        ? sql`upper(${watches.serial}) = upper(${needle})`
        : sql`${watches.stockNo} = ${stockNo} OR upper(${watches.serial}) = upper(${needle})`,
    ))
    .limit(2)

  if (matches.length === 0) {
    return { ok: false, message: `Nothing in stock matches "${needle}".` }
  }
  if (matches.length > 1) {
    return { ok: false, message: `"${needle}" matches more than one watch. Use the stock number.` }
  }

  const match = matches[0]!
  if (!match.lineId) {
    return {
      ok: false,
      message: `Stock ${match.stockNo} (${match.brandName} ${match.model}) is not on ${check.reference}.`,
    }
  }
  if (match.lineStatus !== 'PENDING') {
    return {
      ok: false,
      message: `Stock ${match.stockNo} has already been counted on this check.`,
    }
  }

  const line = await recordLine(checkId, match.watchId, { status: 'FOUND' }, actor)
  return {
    ok: true,
    message: `Stock ${line.stockNo} · ${line.label} counted.`,
    line,
  }
}

// ---------------------------------------------------------------------------
// Finishing
// ---------------------------------------------------------------------------

export interface StockCheckOutcome {
  expected: number
  found: number
  elsewhere: number
  missing: number
  /** How many were never looked for, and have just been called missing. */
  neverCounted: number
}

/**
 * Close the check and turn what is left into an answer.
 *
 * Everything still outstanding becomes missing, because a count that ends with
 * "we did not get to these" has not been taken. The number is reported back so
 * it can be said out loud before anybody agrees to it — a hundred uncounted
 * watches recorded as missing is a very different afternoon from three.
 *
 * Nothing about the watches themselves changes. What to do about a missing
 * watch is a decision for a person with the facts, and a stock take that wrote
 * off inventory on its own is one nobody would dare run.
 */
export async function completeStockCheck(
  checkId: string,
  actor: SessionUser,
): Promise<StockCheckOutcome> {
  return withTransaction(async () => {
    const check = await openCheck(checkId)

    const pending = await db.select({ n: count() }).from(stockCheckLines)
      .where(and(eq(stockCheckLines.checkId, checkId), eq(stockCheckLines.status, 'PENDING')))
    const neverCounted = Number(pending[0]?.n ?? 0)

    if (neverCounted > 0) {
      await db.update(stockCheckLines)
        .set({ status: 'MISSING', checkedById: actor.id, checkedAt: new Date() })
        .where(and(eq(stockCheckLines.checkId, checkId), eq(stockCheckLines.status, 'PENDING')))
    }

    const tallied = await db.select({ status: stockCheckLines.status, n: count() })
      .from(stockCheckLines)
      .where(eq(stockCheckLines.checkId, checkId))
      .groupBy(stockCheckLines.status)

    const of = (status: StockCheckLineStatus) =>
      Number(tallied.find((row) => row.status === status)?.n ?? 0)

    const outcome: StockCheckOutcome = {
      expected: check.expectedCount,
      found: of('FOUND'),
      elsewhere: of('FOUND_ELSEWHERE'),
      missing: of('MISSING'),
      neverCounted,
    }

    await db.update(stockChecks).set({
      status: 'COMPLETED',
      foundCount: outcome.found,
      elsewhereCount: outcome.elsewhere,
      missingCount: outcome.missing,
      completedById: actor.id,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(stockChecks.id, checkId))

    await recordAudit({
      entityType: 'StockCheck', entityId: checkId, action: 'UPDATE', actorId: actor.id,
      summary: `${check.reference} completed: ${outcome.found} found, `
        + `${outcome.elsewhere} elsewhere, ${outcome.missing} missing of ${outcome.expected}`,
    })

    logger.info('stock check completed', { checkId, ...outcome })
    return outcome
  })
}

/** Stop a check without it counting as one. */
export async function abandonStockCheck(
  checkId: string,
  reason: string | null,
  actor: SessionUser,
): Promise<void> {
  const check = await openCheck(checkId)
  await db.update(stockChecks).set({
    status: 'ABANDONED',
    notes: reason?.trim() || check.notes,
    completedById: actor.id,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(stockChecks.id, checkId))

  await recordAudit({
    entityType: 'StockCheck', entityId: checkId, action: 'UPDATE', actorId: actor.id,
    summary: `${check.reference} abandoned${reason ? `: ${reason}` : ''}`,
  })
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listStockChecks(limit = 50) {
  const startedBy = alias(users, 'started_by')
  return db.select({
    id: stockChecks.id,
    reference: stockChecks.reference,
    status: stockChecks.status,
    locationName: locations.name,
    expectedCount: stockChecks.expectedCount,
    foundCount: stockChecks.foundCount,
    missingCount: stockChecks.missingCount,
    elsewhereCount: stockChecks.elsewhereCount,
    startedAt: stockChecks.startedAt,
    completedAt: stockChecks.completedAt,
    startedByName: startedBy.name,
    // Live progress for an open check, which has no stored tally yet.
    countedSoFar: sql<number>`(
      SELECT count(*) FROM ${stockCheckLines} l
      WHERE l.check_id = ${stockChecks.id} AND l.status <> 'PENDING'
    )`,
  })
    .from(stockChecks)
    .leftJoin(locations, eq(locations.id, stockChecks.locationId))
    .leftJoin(startedBy, eq(startedBy.id, stockChecks.startedById))
    .where(isNull(stockChecks.deletedAt))
    .orderBy(desc(stockChecks.startedAt))
    .limit(limit)
}

export async function getStockCheck(id: string) {
  const startedBy = alias(users, 'sc_started_by')
  const completedBy = alias(users, 'sc_completed_by')
  const rows = await db.select({
    check: stockChecks,
    locationName: locations.name,
    startedByName: startedBy.name,
    completedByName: completedBy.name,
  })
    .from(stockChecks)
    .leftJoin(locations, eq(locations.id, stockChecks.locationId))
    .leftJoin(startedBy, eq(startedBy.id, stockChecks.startedById))
    .leftJoin(completedBy, eq(completedBy.id, stockChecks.completedById))
    .where(eq(stockChecks.id, id))
    .limit(1)

  const found = rows[0]
  if (!found || found.check.deletedAt) throw new NotFoundError('Stock check')
  return found
}

export async function getStockCheckLines(checkId: string) {
  const expectedAt = alias(locations, 'expected_at')
  const foundAt = alias(locations, 'found_at')
  const checkedBy = alias(users, 'line_checked_by')

  return db.select({
    id: stockCheckLines.id,
    watchId: stockCheckLines.watchId,
    status: stockCheckLines.status,
    notes: stockCheckLines.notes,
    checkedAt: stockCheckLines.checkedAt,
    checkedByName: checkedBy.name,
    expectedLocationName: expectedAt.name,
    foundLocationName: foundAt.name,
    stockNo: watches.stockNo,
    model: watches.model,
    serial: watches.serial,
    brandName: brands.name,
    purchasePriceGbp: watches.purchasePriceGbp,
    watchStatus: watches.status,
  })
    .from(stockCheckLines)
    .innerJoin(watches, eq(watches.id, stockCheckLines.watchId))
    .innerJoin(brands, eq(brands.id, watches.brandId))
    .leftJoin(expectedAt, eq(expectedAt.id, stockCheckLines.expectedLocationId))
    .leftJoin(foundAt, eq(foundAt.id, stockCheckLines.foundLocationId))
    .leftJoin(checkedBy, eq(checkedBy.id, stockCheckLines.checkedById))
    .where(eq(stockCheckLines.checkId, checkId))
    .orderBy(asc(watches.stockNo))
}

/** The open check somebody should be taken back to, if there is one. */
export async function openStockCheckId(): Promise<string | null> {
  const rows = await db.select({ id: stockChecks.id })
    .from(stockChecks)
    .where(and(eq(stockChecks.status, 'OPEN'), isNull(stockChecks.deletedAt)))
    .orderBy(desc(stockChecks.startedAt))
    .limit(1)
  return rows[0]?.id ?? null
}
