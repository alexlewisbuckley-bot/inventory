import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { suppliers, watches } from '../db/schema'
import { recordAudit } from './audit'
import { checkVatNumber, hmrcConfigured } from './vat-check-service'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { VAT_RECHECK_DAYS } from '@/lib/checks'
import type { RegisterCheckStatus } from '@/lib/enums'
import type { SessionUser } from '../auth/session'
import { logger } from '@/lib/logger'

/**
 * Running and recording the two checks.
 *
 * The asymmetry between them is the point. The VAT check is a question with a
 * definitive external answer, so the system asks it and stores what came back;
 * a person's only involvement is deciding when. The register check has no
 * answer the system can fetch — The Watch Register is a subscription service
 * with no public API and none of the credentials exist here — so a person runs
 * the search and the system records who said what, and when.
 *
 * That second one is deliberately not disguised as automation. A check nobody
 * actually made, presented as though the software made it, is worse than no
 * check at all: it is a false green.
 */

// ---------------------------------------------------------------------------
// VAT — asked of HMRC
// ---------------------------------------------------------------------------

export interface VatCheckOutcome {
  supplierId: string
  supplierName: string
  status: string
  /** True when HMRC answered and confirmed the registration. */
  registered: boolean
  /** The name HMRC holds, where it answered. */
  registeredName: string | null
  /** Set when the registered name is not obviously this supplier. */
  nameMismatch: boolean
  message: string | null
}

/**
 * How close two names have to be before a mismatch is worth raising.
 *
 * Deliberately loose. "Hatton Garden Watches Ltd" against "HATTON GARDEN
 * WATCHES LIMITED" is the same company; the case worth catching is a VAT
 * number belonging to a completely unrelated business, which happens when a
 * digit is misread off an invoice and lands on somebody else's live
 * registration. Anything subtler than that is a question for a person.
 */
function looksLikeSameEntity(a: string | null, b: string | null): boolean {
  if (!a || !b) return true
  const reduce = (value: string) => value
    .toUpperCase()
    .replace(/\b(LIMITED|LTD|PLC|LLP|COMPANY|CO|THE|AND|&)\b/g, '')
    .replace(/[^A-Z0-9]/g, '')
  const left = reduce(a)
  const right = reduce(b)
  if (!left || !right) return true
  return left.includes(right) || right.includes(left)
}

/**
 * Ask HMRC about one supplier and store the answer.
 *
 * Never throws on HMRC's behalf: an outage records UNAVAILABLE and returns,
 * because a supplier's VAT number being unverifiable this minute is not a
 * reason to fail whatever the caller was doing.
 */
export async function runVatCheck(supplierId: string, actor: SessionUser): Promise<VatCheckOutcome> {
  const rows = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1)
  const supplier = rows[0]
  if (!supplier || supplier.deletedAt) throw new NotFoundError('Supplier')

  if (!supplier.vatNo) {
    throw new ValidationError(
      `No VAT number is recorded for ${supplier.name}, so there is nothing to check.`,
      { vatNo: 'Required for a VAT check.' },
    )
  }

  const result = await checkVatNumber(supplier.vatNo, process.env.OWN_VAT_NUMBER)
  const registered = result.status === 'REGISTERED'
  const nameMismatch = registered && !looksLikeSameEntity(supplier.legalName ?? supplier.name, result.name)

  await db.update(suppliers).set({
    vatCheckStatus: result.status,
    // Only a real answer resets the clock. An outage must not look like a
    // fresh check for the next ninety days — that is precisely the failure
    // this whole feature exists to prevent.
    vatCheckedAt: result.status === 'UNAVAILABLE' ? supplier.vatCheckedAt : new Date(),
    vatCheckName: result.name,
    vatCheckAddress: result.address,
    vatCheckReference: result.consultationNumber,
    vatCheckMessage: nameMismatch
      ? `HMRC holds this number against "${result.name}", which does not look like ${supplier.legalName ?? supplier.name}. Confirm it is the same business.`
      : result.message,
    updatedAt: new Date(),
  }).where(eq(suppliers.id, supplierId))

  await recordAudit({
    entityType: 'Supplier',
    entityId: supplierId,
    action: 'UPDATE',
    actorId: actor.id,
    summary: `VAT check on ${supplier.name}: ${result.status.toLowerCase().replace('_', ' ')}`,
    changes: {
      vatCheckStatus: { from: supplier.vatCheckStatus, to: result.status },
    },
  })

  return {
    supplierId,
    supplierName: supplier.name,
    status: result.status,
    registered,
    registeredName: result.name,
    nameMismatch,
    message: result.message,
  }
}

/** Suppliers whose check has lapsed or was never made, oldest first. */
export async function findDueVatChecks(limit = 50) {
  const cutoff = new Date(Date.now() - VAT_RECHECK_DAYS * 86_400_000)
  return db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      vatNo: suppliers.vatNo,
      vatCheckStatus: suppliers.vatCheckStatus,
      vatCheckedAt: suppliers.vatCheckedAt,
    })
    .from(suppliers)
    .where(and(
      isNull(suppliers.deletedAt),
      eq(suppliers.isActive, true),
      sql`${suppliers.vatNo} IS NOT NULL AND ${suppliers.vatNo} <> ''`,
      or(isNull(suppliers.vatCheckedAt), lt(suppliers.vatCheckedAt, cutoff)),
    ))
    .orderBy(sql`${suppliers.vatCheckedAt} asc nulls first`)
    .limit(limit)
}

export interface VatSweepResult {
  checked: number
  registered: number
  problems: VatCheckOutcome[]
  skipped: string | null
}

/**
 * Re-check everything that has fallen due.
 *
 * Sequential rather than parallel, and capped: HMRC rate-limits, and a sweep
 * that trips the limit re-checks nothing at all. Fifty suppliers at a time is
 * far more than this business has, and the cap is what stops that assumption
 * becoming an outage if it ever stops being true.
 */
export async function sweepVatChecks(actor: SessionUser, limit = 50): Promise<VatSweepResult> {
  if (!hmrcConfigured()) {
    return { checked: 0, registered: 0, problems: [], skipped: 'HMRC credentials are not configured, so nothing was checked.' }
  }

  const due = await findDueVatChecks(limit)
  const problems: VatCheckOutcome[] = []
  let registered = 0

  for (const supplier of due) {
    try {
      const outcome = await runVatCheck(supplier.id, actor)
      if (outcome.registered && !outcome.nameMismatch) registered += 1
      else problems.push(outcome)
    } catch (error) {
      // One bad supplier must not end the sweep for the rest.
      logger.warn('vat check failed during sweep', {
        supplierId: supplier.id, error: (error as Error).message,
      })
    }
  }

  return { checked: due.length, registered, problems, skipped: null }
}

// ---------------------------------------------------------------------------
// The Watch Register — searched by a person, recorded here
// ---------------------------------------------------------------------------

/** Where the search is run. Surfaced in the UI so the check is one click away. */
export const WATCH_REGISTER_URL = 'https://www.thewatchregister.com/'

export interface RegisterCheckInput {
  status: Extract<RegisterCheckStatus, 'CLEAR' | 'RECORDED'>
  /** The register's search or certificate reference, where one was issued. */
  reference?: string | null
  notes?: string | null
}

/**
 * Record the outcome of a Watch Register search.
 *
 * `RECORDED` is not treated as an ordinary status change: it means the piece
 * in the safe is reported stolen, so it is audited with its own summary and
 * the notes are kept whether or not anybody typed a reference.
 */
export async function recordRegisterCheck(
  watchId: string,
  input: RegisterCheckInput,
  actor: SessionUser,
): Promise<void> {
  const rows = await db.select().from(watches).where(eq(watches.id, watchId)).limit(1)
  const watch = rows[0]
  if (!watch || watch.deletedAt) throw new NotFoundError('Watch')

  if (!watch.serial) {
    throw new ValidationError(
      'The Watch Register is searched by serial number, and none is recorded for this item. Add the serial first.',
      { serial: 'Required before the register can be checked.' },
    )
  }

  await db.update(watches).set({
    registerCheckStatus: input.status,
    registerCheckedAt: new Date(),
    registerCheckedById: actor.id,
    registerCheckRef: input.reference?.trim() || null,
    registerCheckNotes: input.notes?.trim() || null,
    updatedAt: new Date(),
    version: watch.version + 1,
  }).where(eq(watches.id, watchId))

  await recordAudit({
    entityType: 'Watch',
    entityId: watchId,
    action: 'UPDATE',
    actorId: actor.id,
    summary: input.status === 'RECORDED'
      ? `Stock ${watch.stockNo} found on The Watch Register — serial ${watch.serial} is reported lost or stolen`
      : `Stock ${watch.stockNo} checked against The Watch Register: clear`,
    changes: {
      registerCheckStatus: { from: watch.registerCheckStatus, to: input.status },
    },
  })
}

/** Live stock with no register search against it — the intake backlog. */
export async function findPendingRegisterChecks(limit = 100) {
  return db
    .select({
      id: watches.id,
      stockNo: watches.stockNo,
      model: watches.model,
      serial: watches.serial,
      purchaseDate: watches.purchaseDate,
    })
    .from(watches)
    .where(and(
      isNull(watches.deletedAt),
      inArray(watches.status, ['IN_STOCK', 'RESERVED', 'SALE_AGREED']),
      eq(watches.registerCheckStatus, 'UNCHECKED'),
    ))
    .orderBy(sql`${watches.purchaseDate} desc`)
    .limit(limit)
}
