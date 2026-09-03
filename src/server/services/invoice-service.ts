import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import {
  appSettings, brands, locations, purchaseInvoices, stockMovements, suppliers, userPreferences, watches,
} from '../db/schema'
import { recordAudit } from './audit'
import { extractWithClaude, aiConfigured } from './invoice-ai'
import { getRateTable } from './fx-service'
import { nextStockNo } from '../repositories/watch-repository'
import { newId, slugify } from '@/lib/ids'
import { toBase } from '@/lib/currency'
import { convert } from '@/lib/money'
import { logger } from '@/lib/logger'
import { ConflictError, ValidationError } from '@/lib/errors'
import {
  parseInvoiceText, reconcile, EMPTY_EXTRACTION,
  type ExtractedInvoice, type ExtractedLine,
} from '@/lib/invoice'
import { resolveSupplier, type MatchKind, type SupplierCandidate } from '@/lib/supplier-match'
import { checkVatNumber } from './vat-check-service'
import type { ExtractionMethod } from '@/lib/enums'
import type { SessionUser } from '../auth/session'

/**
 * Booking stock in from the invoice that bought it.
 *
 * The whole point is that nobody retypes anything: a document is dropped on
 * the page and the watches are in stock. That means committing without a
 * review step, which is a deliberate trade — the alternative is a queue of
 * invoices waiting for somebody to press Confirm, which is the manual step
 * this replaces.
 *
 * What makes it safe to commit blind is not confidence in the reader; it is
 * that everything it does is visible and reversible. Every watch carries the
 * invoice it came from, every creation is on the audit trail, the document is
 * stored as sent, deletion is soft, and a line the reader could not resolve is
 * recorded as an issue against the invoice rather than dropped. A wrong row
 * can be corrected in the ten seconds it takes to open it. A missing one, in a
 * system that silently skipped it, could go unnoticed for a year.
 */

export const MAX_INVOICE_BYTES = 12_000_000

const ACCEPTED = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'text/plain', 'text/csv',
])

export interface InvoiceIssue {
  line: string
  reason: string
}

export interface CreatedWatch {
  id: string
  stockNo: number
  label: string
}

export interface InvoiceIntakeResult {
  invoiceId: string
  supplierId: string
  supplierName: string
  supplierCreated: boolean
  matchKind: MatchKind
  invoiceNo: string | null
  currency: string
  vatScheme: string
  extractedBy: ExtractionMethod
  lineCount: number
  created: CreatedWatch[]
  issues: InvoiceIssue[]
  /** Where the two readers differed. Informational — nothing was blocked. */
  disagreements: string[]
}

/** The text layer, where the document has one. */
async function readText(file: { name: string; mimeType: string; buffer: ArrayBuffer }): Promise<string> {
  if (file.mimeType.startsWith('text/')) return new TextDecoder().decode(file.buffer)
  if (file.mimeType !== 'application/pdf') return ''

  try {
    // Imported here rather than at module scope: it pulls in a PDF engine that
    // has no business loading on every request that touches this file.
    const { extractText, getDocumentProxy } = await import('unpdf')
    // `.slice(0)` is load-bearing: pdf.js takes ownership of the array it is
    // given and detaches the underlying ArrayBuffer. Handing it the original
    // left every later read of those bytes — the Claude call, and the copy
    // stored on the invoice row — throwing "detached ArrayBuffer", so a PDF
    // upload failed outright once a key was configured.
    const pdf = await getDocumentProxy(new Uint8Array(file.buffer.slice(0)))
    // `mergePages` returns the whole document as one string rather than an
    // array per page; the parser wants it whole so a line wrapped across a
    // page break still reads as one line.
    const { text } = await extractText(pdf, { mergePages: true })
    return text
  } catch (error) {
    // A scan has no text layer, and an encrypted PDF refuses to open. Neither
    // is fatal — Claude reads the document itself.
    logger.warn('no text layer read from invoice', {
      file: file.name, error: error instanceof Error ? error.message : String(error),
    })
    return ''
  }
}

export async function bookInInvoice(
  file: { name: string; mimeType: string; buffer: ArrayBuffer },
  actor: SessionUser,
): Promise<InvoiceIntakeResult> {
  if (!ACCEPTED.has(file.mimeType)) {
    throw new ValidationError('That file type cannot be read. Upload the invoice as a PDF, an image or plain text.')
  }
  if (file.buffer.byteLength === 0) throw new ValidationError('That file is empty.')
  if (file.buffer.byteLength > MAX_INVOICE_BYTES) {
    throw new ValidationError('That file is over 12 MB. Send the invoice on its own rather than a scanned bundle.')
  }

  const text = await readText(file)
  const brandRows = await db.select({ name: brands.name }).from(brands)

  // Both readers run. Claude reads the document; the rules read its text layer
  // and are what stands in when Claude cannot. Where both produce a reading,
  // Claude's is the answer and the rules become a cross-check.
  const rules = text.trim() ? parseInvoiceText(text, brandRows.map((b) => b.name)) : EMPTY_EXTRACTION
  const { extraction: ai, error: aiError } = await extractWithClaude(file, text)
  const { invoice, source, disagreements } = reconcile(ai, rules)

  const extractedBy: ExtractionMethod = source === 'RULES'
    ? 'RULES'
    : rules.lines.length > 0 ? 'AI_RULES' : 'AI'

  // Read by patterns alone because Claude failed, not because it was switched
  // off. Worth saying on the result rather than only in a log nobody reads.
  if (source === 'RULES' && aiError) {
    disagreements.unshift(`Read by pattern matching only: Claude could not read it — ${aiError}.`)
  }

  if (invoice.lines.length === 0) {
    // Say what actually happened rather than guessing at one cause. The two
    // facts that decide it — whether any text came out of the PDF, and whether
    // Claude was configured and answered — are both known here, and reporting
    // neither turned a five-minute diagnosis into a long one.
    const characters = text.trim().length
    const read = characters > 0
      ? `${characters} characters of text were read from it`
      : 'no text layer could be read from it'
    const reader = !aiConfigured()
      ? 'Claude is not configured — ANTHROPIC_API_KEY is unset on this deployment'
      : ai
        ? 'Claude read it and found no watches on it'
        : `Claude could not read it — ${aiError ?? 'no reason given'}`

    throw new ValidationError(
      `Nothing on that document looked like a watch: ${read}, and ${reader}. `
      + 'If it is definitely a supplier invoice, send it over and it can be read against.',
    )
  }

  // Checked before the transaction opens: it is a network call, and a network
  // call inside a transaction holds a database connection open on somebody
  // else's latency.
  const vatCheck = await checkVatNumber(invoice.supplier.vatNo)
  if (vatCheck.message) disagreements.push(vatCheck.message)
  if (vatCheck.status === 'REGISTERED' && vatCheck.name && invoice.supplier.name) {
    const loose = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!loose(vatCheck.name).includes(loose(invoice.supplier.name).slice(0, 12))
      && !loose(invoice.supplier.name).includes(loose(vatCheck.name).slice(0, 12))) {
      disagreements.push(
        `HMRC holds VAT ${vatCheck.vatNumber} against "${vatCheck.name}", `
        + `but the invoice is from "${invoice.supplier.name}".`,
      )
    }
  }

  // A VAT number that fails its own check digits is not written to the
  // supplier book. It is almost certainly a misread, and suppliers are matched
  // on VAT number — so storing a wrong one does not merely record a bad fact,
  // it risks silently attaching a future invoice to the wrong firm. What the
  // document said is still reported above.
  const checked: ExtractedInvoice = vatCheck.status === 'MALFORMED'
    ? { ...invoice, supplier: { ...invoice.supplier, vatNo: null } }
    : { ...invoice, supplier: { ...invoice.supplier, vatNo: vatCheck.vatNumber } }

  const [rates, rate, defaultLocationId] = await Promise.all([getRateTable(), usdRate(), pickLocation(actor)])
  if (!defaultLocationId) {
    throw new ValidationError('Create a location first — stock has to be booked in somewhere.')
  }

  return withTransaction(async () => {
    const { supplierId, supplierName, matchKind } = await resolveOrCreateSupplier(checked, actor)

    // The same invoice dropped twice is the likeliest way to double-book
    // stock, and with no review step nobody would see it happen.
    if (checked.invoiceNo) {
      const existing = await db.select({ id: purchaseInvoices.id })
        .from(purchaseInvoices)
        .where(and(
          eq(purchaseInvoices.supplierId, supplierId),
          eq(purchaseInvoices.invoiceNo, checked.invoiceNo),
          isNull(purchaseInvoices.deletedAt),
        ))
        .limit(1)
      if (existing[0]) {
        throw new ConflictError(
          `Invoice ${checked.invoiceNo} from ${supplierName} has already been booked in.`,
        )
      }
    }

    const invoiceId = newId('inv')
    const purchaseDate = checked.invoiceDate ? new Date(checked.invoiceDate) : new Date()
    const issues: InvoiceIssue[] = []
    const created: CreatedWatch[] = []

    await db.insert(purchaseInvoices).values({
      id: invoiceId,
      supplierId,
      invoiceNo: checked.invoiceNo,
      invoiceDate: checked.invoiceDate ? new Date(checked.invoiceDate) : null,
      currency: checked.currency,
      netAmount: minor(checked.netAmount),
      vatAmount: minor(checked.vatAmount),
      grossAmount: minor(checked.grossAmount),
      vatScheme: checked.vatScheme,
      fileName: file.name,
      mimeType: file.mimeType,
      byteSize: file.buffer.byteLength,
      data: Buffer.from(file.buffer),
      rawText: text.slice(0, 200_000) || null,
      extractedBy,
      supplierMatch: matchKind,
      lineCount: checked.lines.length,
      createdById: actor.id,
    })

    for (const line of checked.lines) {
      const problem = unbookable(line)
      if (problem) {
        issues.push({ line: describe(line), reason: problem })
        continue
      }

      const brandId = await findOrCreateBrand(line.brand!)
      const unitMinor = Math.round(line.unitAmount! * 100)
      const priceGbp = toBase(unitMinor, checked.currency, rates)
      const lineVatGbp = line.vatAmount !== null
        ? toBase(Math.round(line.vatAmount * 100), checked.currency, rates)
        : null

      // A quantity of three identical watches is three stock records: they are
      // three physical objects that will be moved, priced and sold separately.
      for (let unit = 0; unit < line.quantity; unit += 1) {
        // Only the first of a repeated line can carry the serial — a serial
        // identifies one watch, so copying it across would create the exact
        // duplicate the intake form refuses.
        const serial = unit === 0 ? line.serial : null

        if (serial) {
          const clash = await db.select({ stockNo: watches.stockNo })
            .from(watches)
            .where(and(eq(watches.serial, serial), isNull(watches.deletedAt)))
            .limit(1)
          if (clash[0]) {
            issues.push({
              line: describe(line),
              reason: `Serial ${serial} is already in stock as ${clash[0].stockNo}.`,
            })
            continue
          }
        }

        const id = newId('wch')
        const stockNo = await nextStockNo()

        await db.insert(watches).values({
          id,
          stockNo,
          productType: line.productType,
          brandId,
          model: line.reference ?? line.description.slice(0, 80),
          serial,
          year: line.year,
          supplierId,
          purchaseDate,
          purchasePriceGbp: priceGbp,
          purchasePriceUsd: convert(priceGbp, rate),
          purchaseFxRate: Math.round(rate * 10_000),
          purchaseAmount: unitMinor,
          purchaseCurrency: checked.currency,
          // Deliberately unpriced. The invoice says what it cost, never what it
          // is worth, and inventing an asking price would put a number nobody
          // chose into every margin forecast.
          estSaleGbp: null,
          estSaleAmount: null,
          estSaleCurrency: checked.currency,
          estSaleUsd: null,
          locationId: defaultLocationId,
          status: 'IN_STOCK',
          invoiceId,
          vatScheme: checked.vatScheme,
          vatAmountGbp: lineVatGbp,
          notes: `Booked in from ${file.name}${checked.invoiceNo ? ` (invoice ${checked.invoiceNo})` : ''}.`,
          createdById: actor.id,
        })

        await db.insert(stockMovements).values({
          id: newId('mov'),
          watchId: id,
          fromLocationId: null,
          toLocationId: defaultLocationId,
          reason: 'Booked in from supplier invoice',
          movedById: actor.id,
        })

        created.push({ id, stockNo, label: `${line.brand} ${line.reference ?? ''}`.trim() })
      }
    }

    await db.update(purchaseInvoices)
      .set({
        createdCount: created.length,
        issues: issues.length > 0 || disagreements.length > 0
          ? JSON.stringify({ issues, disagreements })
          : null,
      })
      .where(eq(purchaseInvoices.id, invoiceId))

    if (disagreements.length > 0) {
      logger.info('readers disagreed on an invoice', { invoiceId, disagreements })
    }

    if (aiError) {
      logger.warn('booked in without Claude', { invoiceId, aiError })
    }

    await recordAudit({
      entityType: 'Watch',
      entityId: invoiceId,
      action: 'IMPORT',
      actorId: actor.id,
      summary: `${created.length} booked in from ${file.name} — ${supplierName}`
        + (issues.length > 0 ? `, ${issues.length} line${issues.length === 1 ? '' : 's'} needing attention` : ''),
    })

    logger.info('invoice booked in', {
      invoiceId, supplierId, matchKind, extractedBy,
      created: created.length, issues: issues.length,
    })

    return {
      invoiceId,
      supplierId,
      supplierName,
      supplierCreated: matchKind === 'CREATED',
      matchKind,
      invoiceNo: checked.invoiceNo,
      currency: checked.currency,
      vatScheme: checked.vatScheme,
      extractedBy,
      lineCount: checked.lines.length,
      created,
      issues,
      disagreements,
    }
  })
}

/** One invoice as the supplier list shows it. */
export interface SupplierInvoiceRow {
  id: string
  supplierId: string
  invoiceNo: string | null
  invoiceDate: Date | null
  fileName: string
  currency: string
  grossAmount: number | null
  vatScheme: string
  createdCount: number
}

/**
 * Every stored invoice, newest first, for listing against its supplier.
 *
 * Deliberately without the bytes: this feeds a list, and selecting a bytea
 * column would pull every stored document into memory to render a table of
 * links to them.
 */
export async function listSupplierInvoices(): Promise<SupplierInvoiceRow[]> {
  return db
    .select({
      id: purchaseInvoices.id,
      supplierId: purchaseInvoices.supplierId,
      invoiceNo: purchaseInvoices.invoiceNo,
      invoiceDate: purchaseInvoices.invoiceDate,
      fileName: purchaseInvoices.fileName,
      currency: purchaseInvoices.currency,
      grossAmount: purchaseInvoices.grossAmount,
      vatScheme: purchaseInvoices.vatScheme,
      createdCount: purchaseInvoices.createdCount,
    })
    .from(purchaseInvoices)
    .where(isNull(purchaseInvoices.deletedAt))
    .orderBy(desc(purchaseInvoices.invoiceDate), desc(purchaseInvoices.createdAt))
}

/** Why this line cannot become stock, or null when it can. */
function unbookable(line: ExtractedLine): string | null {
  if (!line.brand) return 'No maker on the line, so it cannot be filed under a brand.'
  if (line.unitAmount === null || line.unitAmount <= 0) return 'No price on the line.'
  if (!line.reference && !line.description) return 'Nothing on the line identifies what was bought.'
  return null
}

const describe = (line: ExtractedLine): string =>
  line.description || [line.brand, line.reference, line.serial].filter(Boolean).join(' ') || 'Unreadable line'

const minor = (amount: number | null): number | null =>
  amount === null ? null : Math.round(amount * 100)

/**
 * The supplier on the invoice, matched to the book or added to it.
 *
 * Creating rather than refusing is the point: a new dealer's first invoice
 * should book its watches in, not stop at a form asking who they are. What the
 * invoice states about them is carried onto the new record, so the supplier
 * arrives with its VAT number and contact details rather than as a bare name.
 */
async function resolveOrCreateSupplier(
  invoice: ExtractedInvoice,
  actor: SessionUser,
): Promise<{ supplierId: string; supplierName: string; matchKind: MatchKind }> {
  const name = invoice.supplier.name ?? invoice.supplier.legalName
  if (!name) {
    throw new ValidationError('No supplier could be read from that invoice, so there is nobody to book the stock against.')
  }

  const candidates: SupplierCandidate[] = await db.select({
    id: suppliers.id,
    name: suppliers.name,
    legalName: suppliers.legalName,
    vatNo: suppliers.vatNo,
    registrationNo: suppliers.registrationNo,
    email: suppliers.email,
    contactEmail: suppliers.contactEmail,
  }).from(suppliers).where(isNull(suppliers.deletedAt))

  const resolution = resolveSupplier(invoice.supplier, candidates)

  if (resolution.candidate) {
    // A match that arrived with details the record was missing improves it.
    // Never overwrites: what somebody typed outranks what was read off a scan,
    // so only fields that are actually empty are filled. This is how the
    // address and phone reach a supplier that was created from an earlier
    // invoice that did not carry them.
    const current = (await db.select().from(suppliers).where(eq(suppliers.id, resolution.candidate.id)).limit(1))[0]
    if (current) {
      const fill: Partial<typeof suppliers.$inferInsert> = {}
      const fillable = {
        vatNo: invoice.supplier.vatNo,
        registrationNo: invoice.supplier.registrationNo,
        email: invoice.supplier.email,
        phone: invoice.supplier.phone,
        addressLine1: invoice.supplier.addressLine1,
        addressLine2: invoice.supplier.addressLine2,
        city: invoice.supplier.city,
        postcode: invoice.supplier.postcode,
        country: invoice.supplier.country,
        legalName: invoice.supplier.legalName,
      } as const

      for (const [field, value] of Object.entries(fillable)) {
        if (value && !current[field as keyof typeof current]) {
          Object.assign(fill, { [field]: value })
        }
      }

      if (Object.keys(fill).length > 0) {
        await db.update(suppliers).set(fill).where(eq(suppliers.id, resolution.candidate.id))
        await recordAudit({
          entityType: 'Supplier', entityId: resolution.candidate.id, action: 'UPDATE', actorId: actor.id,
          summary: `${Object.keys(fill).length} detail(s) filled in from an invoice`,
        })
      }
    }
    return {
      supplierId: resolution.candidate.id,
      supplierName: resolution.candidate.name,
      matchKind: resolution.kind,
    }
  }

  const id = newId('sup')
  await db.insert(suppliers).values({
    id,
    name,
    legalName: invoice.supplier.legalName,
    vatNo: invoice.supplier.vatNo,
    registrationNo: invoice.supplier.registrationNo,
    email: invoice.supplier.email,
    phone: invoice.supplier.phone,
    addressLine1: invoice.supplier.addressLine1,
    addressLine2: invoice.supplier.addressLine2,
    city: invoice.supplier.city,
    postcode: invoice.supplier.postcode,
    country: invoice.supplier.country,
    defaultCurrency: invoice.currency,
    entityType: /\b(limited|ltd|plc|llp|gmbh|inc)\b/i.test(invoice.supplier.legalName ?? name)
      ? 'LIMITED_COMPANY'
      : 'UNKNOWN',
    notes: 'Created automatically from a supplier invoice.',
  })

  await recordAudit({
    entityType: 'Supplier', entityId: id, action: 'CREATE', actorId: actor.id,
    summary: `${name} added from an invoice`,
  })

  return { supplierId: id, supplierName: name, matchKind: 'CREATED' }
}

async function findOrCreateBrand(name: string): Promise<string> {
  const slug = slugify(name)
  const found = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, slug)).limit(1)
  if (found[0]) return found[0].id

  const id = newId('brd')
  await db.insert(brands).values({ id, name, slug })
  return id
}

/**
 * Where the stock lands.
 *
 * An invoice never says which of your locations a watch is going to, so it
 * goes where that person's stock normally goes — their default location, or
 * the first one if they have not set one. It can be moved in two clicks, and
 * the movement is logged like any other transfer.
 */
async function pickLocation(actor: SessionUser): Promise<string | null> {
  const preference = await db.select({ id: userPreferences.defaultLocationId })
    .from(userPreferences)
    .where(eq(userPreferences.userId, actor.id))
    .limit(1)
  if (preference[0]?.id) return preference[0].id

  const first = await db.select({ id: locations.id })
    .from(locations)
    .where(isNull(locations.deletedAt))
    .orderBy(asc(locations.sortOrder))
    .limit(1)
  return first[0]?.id ?? null
}

/**
 * GBP→USD from settings, as the intake form reads it.
 *
 * The rate table is scaled by RATE_SCALE and is the wrong shape for the legacy
 * USD columns, which want a plain multiplier — reading it as one is how a
 * purchase gets recorded ten thousand times over.
 */
async function usdRate(): Promise<number> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, 'finance.fxGbpUsd')).limit(1)
  const parsed = Number(rows[0]?.value)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return Number(process.env.DEFAULT_FX_GBP_USD ?? 1.33)
}
