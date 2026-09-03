import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../db/client'
import { supplierDocuments, suppliers, users, watches } from '../db/schema'
import { recordAudit } from './audit'
import { checkVatNumber, hmrcConfigured } from './vat-check-service'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { ID_VALIDITY_MONTHS, VAT_RECHECK_DAYS, addMonths } from '@/lib/checks'
import type { IdCheckStatus, IdDocumentKind, RegisterCheckStatus } from '@/lib/enums'
import { newId } from '@/lib/ids'
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

// ---------------------------------------------------------------------------
// The director, and the evidence they are who the company says they are
// ---------------------------------------------------------------------------

/**
 * How big an identity document may be.
 *
 * A phone photograph of a passport page is a couple of megabytes; eight is
 * generous. The cap exists because these go in the row, and a row nobody can
 * read back is worse than a rejected upload.
 */
export const MAX_ID_BYTES = 8 * 1024 * 1024

const ALLOWED_ID_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
])

export interface SupplierDocumentRow {
  id: string
  supplierId: string
  kind: IdDocumentKind
  holderName: string | null
  expiresOn: string | null
  fileName: string
  mimeType: string
  byteSize: number
  uploadedByName: string | null
  createdAt: Date
}

/**
 * The documents held against a supplier, without their bytes.
 *
 * The `data` column is deliberately not selected: listing what is on file
 * should not drag several megabytes of passport scans through the process, and
 * the only thing that should ever read those bytes is the one route that
 * serves a single document and writes the access to the audit trail.
 */
export async function listSupplierDocuments(supplierId?: string): Promise<SupplierDocumentRow[]> {
  const uploader = alias(users, 'document_uploader')
  const rows = await db
    .select({
      id: supplierDocuments.id,
      supplierId: supplierDocuments.supplierId,
      kind: supplierDocuments.kind,
      holderName: supplierDocuments.holderName,
      expiresOn: supplierDocuments.expiresOn,
      fileName: supplierDocuments.fileName,
      mimeType: supplierDocuments.mimeType,
      byteSize: supplierDocuments.byteSize,
      uploadedByName: uploader.name,
      createdAt: supplierDocuments.createdAt,
    })
    .from(supplierDocuments)
    .leftJoin(uploader, eq(uploader.id, supplierDocuments.uploadedById))
    .where(and(
      isNull(supplierDocuments.deletedAt),
      supplierId ? eq(supplierDocuments.supplierId, supplierId) : undefined,
    ))
    .orderBy(desc(supplierDocuments.createdAt))
  return rows
}

export interface IdDocumentInput {
  supplierId: string
  kind: IdDocumentKind
  holderName?: string | null
  /** The document's own expiry, as printed on it. */
  expiresOn?: string | null
  fileName: string
  mimeType: string
  buffer: ArrayBuffer
}

/** Attach an identity document to a supplier. */
export async function addSupplierDocument(
  input: IdDocumentInput,
  actor: SessionUser,
): Promise<string> {
  const rows = await db.select({ id: suppliers.id, name: suppliers.name, deletedAt: suppliers.deletedAt })
    .from(suppliers).where(eq(suppliers.id, input.supplierId)).limit(1)
  const supplier = rows[0]
  if (!supplier || supplier.deletedAt) throw new NotFoundError('Supplier')

  if (input.buffer.byteLength === 0) throw new ValidationError('That file is empty.')
  if (input.buffer.byteLength > MAX_ID_BYTES) {
    throw new ValidationError('That file is over 8 MB. A photograph of the page is enough — it does not need to be a full scan.')
  }
  if (!ALLOWED_ID_TYPES.has(input.mimeType)) {
    throw new ValidationError('Attach a PDF or a photograph of the document.')
  }

  const id = newId('sdo')
  await db.insert(supplierDocuments).values({
    id,
    supplierId: input.supplierId,
    kind: input.kind,
    holderName: input.holderName?.trim() || null,
    expiresOn: input.expiresOn || null,
    fileName: input.fileName.slice(0, 200),
    mimeType: input.mimeType,
    byteSize: input.buffer.byteLength,
    data: Buffer.from(input.buffer),
    uploadedById: actor.id,
  })

  await recordAudit({
    entityType: 'Supplier',
    entityId: input.supplierId,
    action: 'UPDATE',
    actorId: actor.id,
    // Names the document but not its contents: an audit summary is read by
    // more people than the document is.
    summary: `Identity document attached to ${supplier.name} (${input.kind.toLowerCase().replace('_', ' ')})`,
  })

  return id
}

/**
 * Remove a document.
 *
 * Soft, like everything else here. An identity document that was attached and
 * then vanished without trace is precisely the gap an audit is looking for.
 */
export async function deleteSupplierDocument(id: string, actor: SessionUser): Promise<void> {
  const rows = await db.select().from(supplierDocuments).where(eq(supplierDocuments.id, id)).limit(1)
  const document = rows[0]
  if (!document || document.deletedAt) throw new NotFoundError('Document')

  await db.update(supplierDocuments).set({ deletedAt: new Date() }).where(eq(supplierDocuments.id, id))
  await recordAudit({
    entityType: 'Supplier',
    entityId: document.supplierId,
    action: 'DELETE',
    actorId: actor.id,
    summary: `Identity document ${document.fileName} removed`,
  })
}

export interface IdCheckInput {
  status: Extract<IdCheckStatus, 'VERIFIED' | 'REJECTED'>
  /** The document relied on. Required to verify; there is nothing to verify without one. */
  documentId?: string | null
  notes?: string | null
}

/**
 * Record that somebody has looked at the director's identity document.
 *
 * Verifying without naming the document is refused. The whole value of the
 * record is that it says which piece of evidence was relied on — a green light
 * with no document behind it is the false green this is meant to prevent, and
 * the document's expiry is copied onto the check so a passport that lapses
 * afterwards turns the light red rather than waiting out the six months.
 */
export async function recordIdCheck(
  supplierId: string,
  input: IdCheckInput,
  actor: SessionUser,
): Promise<void> {
  const rows = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1)
  const supplier = rows[0]
  if (!supplier || supplier.deletedAt) throw new NotFoundError('Supplier')

  if (!supplier.directorName) {
    throw new ValidationError(
      `No director is recorded for ${supplier.name}, so there is nobody to identify. Add them to the supplier record first.`,
      { directorName: 'Required before an ID check.' },
    )
  }

  let expiresOn: string | null = null
  if (input.status === 'VERIFIED') {
    if (!input.documentId) {
      throw new ValidationError('Choose the identity document this check was made against.')
    }
    const found = await db.select({
      id: supplierDocuments.id,
      supplierId: supplierDocuments.supplierId,
      expiresOn: supplierDocuments.expiresOn,
      deletedAt: supplierDocuments.deletedAt,
    }).from(supplierDocuments).where(eq(supplierDocuments.id, input.documentId)).limit(1)
    const document = found[0]
    if (!document || document.deletedAt || document.supplierId !== supplierId) {
      throw new NotFoundError('Document')
    }
    expiresOn = document.expiresOn
  }

  await db.update(suppliers).set({
    idCheckStatus: input.status,
    idCheckedAt: new Date(),
    idCheckedById: actor.id,
    idCheckNotes: input.notes?.trim() || null,
    idDocumentExpiresOn: expiresOn,
    updatedAt: new Date(),
  }).where(eq(suppliers.id, supplierId))

  await recordAudit({
    entityType: 'Supplier',
    entityId: supplierId,
    action: 'UPDATE',
    actorId: actor.id,
    summary: input.status === 'VERIFIED'
      ? `${supplier.directorName} identified for ${supplier.name}`
      : `Identity document for ${supplier.name} rejected`,
    changes: { idCheckStatus: { from: supplier.idCheckStatus, to: input.status } },
  })
}

/** Suppliers whose identification has lapsed, is missing, or was never made. */
export async function findDueIdChecks(limit = 100) {
  const cutoff = addMonths(new Date(), -ID_VALIDITY_MONTHS)!
  return db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      directorName: suppliers.directorName,
      idCheckStatus: suppliers.idCheckStatus,
      idCheckedAt: suppliers.idCheckedAt,
    })
    .from(suppliers)
    .where(and(
      isNull(suppliers.deletedAt),
      eq(suppliers.isActive, true),
      or(
        isNull(suppliers.directorName),
        ne(suppliers.idCheckStatus, 'VERIFIED'),
        isNull(suppliers.idCheckedAt),
        lt(suppliers.idCheckedAt, cutoff),
      ),
    ))
    .orderBy(sql`${suppliers.idCheckedAt} asc nulls first`)
    .limit(limit)
}
