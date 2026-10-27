import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import {
  customerAliases, sales, watches, xeroImports, xeroInvoices, xeroLinks,
} from '../db/schema'
import { newId } from '@/lib/ids'
import { NotFoundError, ConflictError } from '@/lib/errors'
import { BASE_CURRENCY, type CurrencyCode } from '@/lib/enums'
import { RATE_SCALE, type RateTable } from '@/lib/currency'
import { getRateTable } from './fx-service'
import { recordAudit } from './audit'
import { readTable } from './import-service'
import { saleMoney } from './watch-service'
import { logger } from '@/lib/logger'
import {
  parseXeroExport, searchableText, type XeroInvoice,
} from '@/lib/xero-invoice'
import {
  matchInvoices, looksLikeBuyBack, normaliseName,
  type SaleCandidate, type MatchTier, type MatchedSale,
} from '@/lib/xero-match'
import { allocate, allocationBalances } from '@/lib/xero-allocate'
import {
  proposeChanges, exceptionsFor, FIELD_LABELS,
  type ProposedChange, type ReconcileException, type SaleSnapshot, type XeroField,
} from '@/lib/xero-diff'

/**
 * Reconciling the sales ledger against Xero.
 *
 * Alex: "We reconciled 14 sales against 12 Xero invoices by hand today and
 * 11 of them had at least one error. That needs to stop."
 *
 * Three steps, deliberately separate:
 *
 *   stage   read the file, match it, work out what it would change, write
 *           none of it
 *   review  the screen, built from what was staged
 *   apply   write only what somebody ticked, with an audit entry naming the
 *           import it came from
 *
 * They are separate because of the three things Alex said not to do: don't
 * overwrite what the system owns, don't auto-apply, don't create sales from
 * invoices. A single function that read a file and wrote the ledger would
 * break all three the first time somebody dropped the wrong file.
 *
 * All the judgement — the parsing, the matching, the allocating, the
 * diffing — lives in `src/lib/xero-*.ts` and is pure. This file is the part
 * that talks to the database, and it is deliberately the thin part.
 */

/** Only live sales are reconcilable. A voided one belongs to nobody. */
const liveSale = () => and(isNull(sales.voidedAt), isNull(sales.deletedAt))

function toBaseWith(rates: RateTable) {
  return (amountMinor: number, currency: CurrencyCode): number =>
    currency === BASE_CURRENCY
      ? amountMinor
      : Math.round((amountMinor * RATE_SCALE) / (rates[currency] ?? RATE_SCALE))
}

/**
 * Read a dropped file and stage everything it implies.
 *
 * Nothing on a sale is touched. The import, its invoices and the proposed
 * links are written; the ledger is not. Alex: "Nothing writes until
 * approved."
 */
export async function stageImport(
  file: { name: string; buffer: ArrayBuffer },
  actor: { id: string },
): Promise<{ importId: string; invoiceCount: number; matchedCount: number; skippedRows: number }> {
  const table = await readTable(file)
  const { invoices, skipped } = parseXeroExport(table, { base: BASE_CURRENCY })
  if (invoices.length === 0) {
    throw new ConflictError('No invoices could be read from that file. Export the Sales Invoices list from Xero as CSV or XLSX.')
  }

  // Money is held in 32-bit integers throughout, as every other amount in
  // the system is. A figure past that is a misread column — a reference
  // number or a date landing in the total — far more often than it is a
  // real invoice, and either way it must say so rather than fail with the
  // driver's own error about a portal parameter.
  const tooBig = invoices.find((invoice) => Math.abs(invoice.total) > 2_147_483_647)
  if (tooBig) {
    throw new ConflictError(
      `Invoice ${tooBig.invoiceNo} reads as ${(tooBig.total / 100).toLocaleString('en-GB')} ${tooBig.currency}, which is too large to be a total. Check the file's amount column.`,
    )
  }

  const [rates, candidates, aliases] = await Promise.all([
    getRateTable(),
    liveSaleCandidates(),
    db.select({ systemName: customerAliases.systemName, xeroName: customerAliases.xeroName })
      .from(customerAliases),
  ])
  const toBase = toBaseWith(rates)
  const { matched } = matchInvoices(invoices, candidates.map(toCandidate), { toBase, aliases })

  const byId = new Map(candidates.map((sale) => [sale.id, sale]))
  const importId = newId('xim')

  await withTransaction(async () => {
    const dates = invoices.map((i) => i.invoiceDate).filter((d): d is Date => d !== null)
    await db.insert(xeroImports).values({
      id: importId,
      fileName: file.name,
      baseCurrency: BASE_CURRENCY,
      invoiceCount: invoices.length,
      skippedRows: skipped,
      importedById: actor.id,
      // The period this file was meant to account for, so the ledger can
      // later ask which sales inside it the accounts never saw.
      coversFrom: dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
      coversTo: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
    })

    // By position, not by number: a file can carry the same invoice number
    // twice, and keying on it would hand both rows the same sales.
    const linkedAt = new Map(matched.map((m) => [m.at, m]))
    for (const [at, invoice] of invoices.entries()) {
      const invoiceRowId = newId('xin')
      await db.insert(xeroInvoices).values({
        id: invoiceRowId,
        importId,
        invoiceNo: invoice.invoiceNo,
        contactName: invoice.contactName,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        total: invoice.total,
        fxRate: invoice.currency === BASE_CURRENCY ? RATE_SCALE : rates[invoice.currency] ?? null,
        status: invoice.status,
        reference: invoice.reference,
        lines: invoice.lines,
        sourceRows: invoice.rows,
        // A suggestion, never a decision: the user confirms the bucket.
        bucket: !linkedAt.has(at) && looksLikeBuyBack(invoice)
          ? 'BUYBACK'
          : 'SALE',
      })

      const match = linkedAt.get(at)
      if (!match) continue
      await writeLinks({ importId, invoiceRowId, invoice, matches: match.sales, byId })
    }
  })

  logger.info('xero import staged', {
    importId, invoices: invoices.length, matched: matched.length, actorId: actor.id,
  })
  return {
    importId,
    invoiceCount: invoices.length,
    matchedCount: matched.reduce((n, m) => n + m.sales.length, 0),
    skippedRows: skipped,
  }
}

/**
 * Write the links for one invoice, with its total shared across them.
 *
 * The share is weighted by what each sale already says it was for, so a
 * two-watch invoice splits the way the two watches were priced. The last
 * line carries the rounding, and the result is asserted before it is
 * stored: the one promise this makes is that the parts equal the whole.
 */
async function writeLinks(
  { importId, invoiceRowId, invoice, matches, byId }: {
    importId: string
    invoiceRowId: string
    invoice: XeroInvoice
    matches: MatchedSale[]
    byId: Map<string, LiveSale>
  },
): Promise<void> {
  // Weighted in base, never in each sale's own currency: see `amountBase`.
  const shares = allocate(invoice.total, matches.map((match) => ({
    item: match,
    weight: byId.get(match.saleId)?.amountBase ?? 0,
  })))
  if (!allocationBalances(invoice.total, shares)) {
    throw new ConflictError(`Invoice ${invoice.invoiceNo} could not be split across its sales.`)
  }
  for (const share of shares) {
    await db.insert(xeroLinks).values({
      id: newId('xlk'),
      importId,
      xeroInvoiceId: invoiceRowId,
      saleId: share.item.saleId,
      tier: share.item.tier,
      allocated: share.amount,
    }).onConflictDoNothing()
  }
}

interface LiveSale {
  id: string
  stockNo: number | null
  invoiceNo: string | null
  saleDate: Date
  customerName: string | null
  /** As invoiced, in the sale's own currency. For the diff. */
  saleAmount: number | null
  /**
   * The same sale in base, which is the only figure that may be compared
   * or weighed against another sale's.
   *
   * Held apart from `saleAmount` because conflating the two is the bug
   * Alex's rule is aimed at — "Never compare amounts across currencies
   * without converting first". A USD 12,500 sale and a GBP 32,106 one
   * weighted by their raw minor units split an invoice 28:72, which is the
   * ratio of 1,250,000 cents to 3,210,613 pence and means nothing at all.
   */
  amountBase: number
  saleCurrency: CurrencyCode
  paymentStatus: SaleSnapshot['paymentStatus']
  paidOn: Date | null
  dueOn: Date | null
  channel: string
  watchId: string
  purchasePriceGbp: number | null
}

async function liveSaleCandidates(): Promise<LiveSale[]> {
  const rows = await db
    .select({
      id: sales.id,
      stockNo: watches.stockNo,
      invoiceNo: sales.invoiceNo,
      saleDate: sales.saleDate,
      customerName: sales.customerName,
      saleAmount: sales.saleAmount,
      saleAmountGbp: sales.saleAmountGbp,
      saleCurrency: sales.saleCurrency,
      paymentStatus: sales.paymentStatus,
      paidOn: sales.paidOn,
      dueOn: sales.dueOn,
      channel: sales.channel,
      watchId: sales.watchId,
      purchasePriceGbp: watches.purchasePriceGbp,
    })
    .from(sales)
    .innerJoin(watches, eq(watches.id, sales.watchId))
    .where(liveSale())

  return rows.map((row) => ({
    ...row,
    // A sale booked before the original-amount column existed has only its
    // base figure. Using that rather than null keeps it matchable.
    saleAmount: row.saleAmount ?? row.saleAmountGbp,
    amountBase: row.saleAmountGbp,
  }))
}

const toCandidate = (sale: LiveSale): SaleCandidate => ({
  id: sale.id,
  stockNo: sale.stockNo,
  invoiceNo: sale.invoiceNo,
  customerName: sale.customerName,
  saleDate: sale.saleDate,
  amountBase: sale.amountBase,
})

const toSnapshot = (sale: LiveSale): SaleSnapshot => ({
  id: sale.id,
  stockNo: sale.stockNo,
  invoiceNo: sale.invoiceNo,
  saleDate: sale.saleDate,
  customerName: sale.customerName,
  saleAmount: sale.saleAmount,
  saleCurrency: sale.saleCurrency,
  paymentStatus: sale.paymentStatus,
  paidOn: sale.paidOn,
  dueOn: sale.dueOn,
})

/* ================= the review screen ================= */

export interface ReviewSale {
  saleId: string
  stockNo: number | null
  tier: MatchTier
  allocated: number
  approved: boolean | null
  changes: ProposedChange[]
  exceptions: ReconcileException[]
}

export interface ReviewInvoice {
  id: string
  invoiceNo: string
  contactName: string
  invoiceDate: Date | null
  currency: CurrencyCode
  total: number
  /** The invoice total in base, at the rate on the row. */
  totalBase: number
  fxRate: number | null
  status: string
  reference: string
  bucket: string
  lines: Array<{ description: string; amount: number | null }>
  sales: ReviewSale[]
  /** The alias this invoice's match would be worth remembering as. */
  proposedAlias: { systemName: string; xeroName: string } | null
  looksLikeBuyBack: boolean
}

export interface Review {
  importId: string
  fileName: string
  appliedAt: Date | null
  skippedRows: number
  invoices: ReviewInvoice[]
  /** Live sales no invoice in this file accounted for. */
  unmatchedSales: Array<{ saleId: string; stockNo: number | null; invoiceNo: string | null; customerName: string | null; saleDate: Date }>
  exceptions: ReconcileException[]
  /** How many field changes are waiting to be approved. */
  changeCount: number
}

export async function buildReview(importId: string): Promise<Review> {
  const [header] = await db.select().from(xeroImports).where(eq(xeroImports.id, importId)).limit(1)
  if (!header) throw new NotFoundError('That import could not be found.')

  const [invoiceRows, linkRows, candidates, rates, aliases] = await Promise.all([
    db.select().from(xeroInvoices).where(eq(xeroInvoices.importId, importId))
      .orderBy(xeroInvoices.invoiceNo),
    db.select().from(xeroLinks).where(eq(xeroLinks.importId, importId)),
    liveSaleCandidates(),
    getRateTable(),
    db.select({ xeroKey: customerAliases.xeroKey }).from(customerAliases),
  ])

  const byId = new Map(candidates.map((sale) => [sale.id, sale]))
  const linksByInvoice = new Map<string, typeof linkRows>()
  for (const link of linkRows) {
    linksByInvoice.set(link.xeroInvoiceId, [...(linksByInvoice.get(link.xeroInvoiceId) ?? []), link])
  }
  const knownAlias = new Set(aliases.map((a) => a.xeroKey))
  const linkedSaleIds = new Set(linkRows.map((link) => link.saleId))
  const exceptions: ReconcileException[] = []

  const invoices: ReviewInvoice[] = invoiceRows.map((row) => {
    const asInvoice = rowToInvoice(row)
    const links = linksByInvoice.get(row.id) ?? []
    const rate = row.fxRate ?? (row.currency === BASE_CURRENCY ? RATE_SCALE : rates[row.currency] ?? RATE_SCALE)

    const reviewSales: ReviewSale[] = links.flatMap((link) => {
      const sale = byId.get(link.saleId)
      if (!sale) return []
      const found = exceptionsFor(toSnapshot(sale), asInvoice, link.allocated)
      exceptions.push(...found)
      return [{
        saleId: sale.id,
        stockNo: sale.stockNo,
        tier: link.tier as MatchTier,
        allocated: link.allocated,
        approved: link.approved,
        changes: proposeChanges(toSnapshot(sale), asInvoice, link.allocated),
        exceptions: found,
      }]
    })

    if (reviewSales.length === 0 && row.bucket === 'SALE') {
      exceptions.push({
        kind: 'INVOICE_WITHOUT_SALE',
        invoiceNo: row.invoiceNo,
        saleId: null,
        stockNo: null,
        detail: `${row.contactName || 'no contact'} · ${row.currency} ${(row.total / 100).toFixed(2)}`,
      })
    }

    // Worth offering as an alias only where the names differ and we have
    // not already learned this one.
    const only = reviewSales.length === 1 ? byId.get(reviewSales[0]!.saleId) : null
    const proposedAlias = only?.customerName && row.contactName
      && normaliseName(only.customerName) !== normaliseName(row.contactName)
      && !knownAlias.has(normaliseName(row.contactName))
      ? { systemName: only.customerName, xeroName: row.contactName }
      : null

    return {
      id: row.id,
      invoiceNo: row.invoiceNo,
      contactName: row.contactName,
      invoiceDate: row.invoiceDate,
      currency: row.currency,
      total: row.total,
      totalBase: row.currency === BASE_CURRENCY
        ? row.total
        : Math.round((row.total * RATE_SCALE) / rate),
      fxRate: row.fxRate,
      status: row.status,
      reference: row.reference,
      bucket: row.bucket,
      lines: row.lines.map((line) => ({ description: line.description, amount: line.amount })),
      sales: reviewSales,
      proposedAlias,
      looksLikeBuyBack: looksLikeBuyBack(asInvoice),
    }
  })

  /*
   * Sales this file should have accounted for and did not.
   *
   * Scoped to the period the export covers, which is the difference
   * between a useful exception and an unreadable one: a month of Xero
   * invoices measured against the whole book reports every sale the firm
   * has ever made as missing. The window is the first and last invoice
   * date in the file, widened by the same three days the matcher allows
   * between an invoice and the sale behind it.
   */
  const dates = invoiceRows.map((row) => row.invoiceDate).filter((d): d is Date => d !== null)
  const from = dates.length > 0
    ? new Date(Math.min(...dates.map((d) => d.getTime())) - 3 * 86_400_000)
    : null
  const to = dates.length > 0
    ? new Date(Math.max(...dates.map((d) => d.getTime())) + 3 * 86_400_000)
    : null

  const unmatchedSales = candidates
    .filter((sale) => !linkedSaleIds.has(sale.id))
    .filter((sale) => !from || !to
      || (sale.saleDate >= from && sale.saleDate <= to))
    .map((sale) => ({
      saleId: sale.id,
      stockNo: sale.stockNo,
      invoiceNo: sale.invoiceNo,
      customerName: sale.customerName,
      saleDate: sale.saleDate,
    }))
  for (const sale of unmatchedSales) {
    exceptions.push({
      kind: 'SALE_WITHOUT_INVOICE',
      invoiceNo: sale.invoiceNo,
      saleId: sale.saleId,
      stockNo: sale.stockNo,
      detail: sale.customerName ?? 'no customer',
    })
  }

  return {
    importId,
    fileName: header.fileName,
    appliedAt: header.appliedAt,
    skippedRows: header.skippedRows,
    invoices,
    unmatchedSales,
    exceptions,
    changeCount: invoices.reduce(
      (n, invoice) => n + invoice.sales.reduce((m, sale) => m + sale.changes.length, 0), 0),
  }
}

function rowToInvoice(row: typeof xeroInvoices.$inferSelect): XeroInvoice {
  return {
    invoiceNo: row.invoiceNo,
    contactName: row.contactName,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate,
    paidDate: null,
    currency: row.currency,
    total: row.total,
    status: row.status as XeroInvoice['status'],
    reference: row.reference,
    lines: row.lines.map((line) => ({
      description: line.description,
      amount: line.amount,
      quantity: line.quantity,
    })),
    rows: row.sourceRows,
  }
}

/* ================= editing the review ================= */

/** Link a sale to an invoice by hand, or move it from another one. */
export async function linkSale(importId: string, xeroInvoiceId: string, saleId: string): Promise<void> {
  const [invoice] = await db.select().from(xeroInvoices)
    .where(and(eq(xeroInvoices.id, xeroInvoiceId), eq(xeroInvoices.importId, importId))).limit(1)
  if (!invoice) throw new NotFoundError('That invoice is not part of this import.')

  await withTransaction(async () => {
    await db.delete(xeroLinks)
      .where(and(eq(xeroLinks.importId, importId), eq(xeroLinks.saleId, saleId)))
    await db.insert(xeroLinks).values({
      id: newId('xlk'),
      importId,
      xeroInvoiceId,
      saleId,
      tier: 'manual',
      allocated: 0,
    })
  })
  await reallocate(xeroInvoiceId)
}

export async function unlinkSale(importId: string, saleId: string): Promise<void> {
  const [link] = await db.select().from(xeroLinks)
    .where(and(eq(xeroLinks.importId, importId), eq(xeroLinks.saleId, saleId))).limit(1)
  if (!link) return
  await db.delete(xeroLinks).where(eq(xeroLinks.id, link.id))
  await reallocate(link.xeroInvoiceId)
}

/**
 * Share an invoice's total across whatever is linked to it now.
 *
 * Run after every link change, because an allocation is only correct for
 * the set of sales it was worked out against: unlink one of three watches
 * and the other two are still carrying a third each.
 */
async function reallocate(xeroInvoiceId: string): Promise<void> {
  const [invoice] = await db.select().from(xeroInvoices).where(eq(xeroInvoices.id, xeroInvoiceId)).limit(1)
  if (!invoice) return
  const links = await db.select().from(xeroLinks).where(eq(xeroLinks.xeroInvoiceId, xeroInvoiceId))
  if (links.length === 0) return

  // The base figure, for the same reason the first allocation uses it.
  const amounts = await db
    .select({ id: sales.id, amountBase: sales.saleAmountGbp })
    .from(sales).where(inArray(sales.id, links.map((link) => link.saleId)))
  const weightOf = new Map(amounts.map((row) => [row.id, row.amountBase ?? 0]))

  const shares = allocate(invoice.total, links.map((link) => ({
    item: link, weight: weightOf.get(link.saleId) ?? 0,
  })))
  if (!allocationBalances(invoice.total, shares)) {
    throw new ConflictError(`Invoice ${invoice.invoiceNo} could not be split across its sales.`)
  }
  for (const share of shares) {
    await db.update(xeroLinks).set({ allocated: share.amount }).where(eq(xeroLinks.id, share.item.id))
  }
}

/** Correct the rate an invoice is read in base at. */
export async function setInvoiceRate(importId: string, xeroInvoiceId: string, rate: number): Promise<void> {
  if (!Number.isFinite(rate) || rate <= 0) throw new ConflictError('Enter a rate above zero.')
  await db.update(xeroInvoices)
    .set({ fxRate: Math.round(rate * RATE_SCALE) })
    .where(and(eq(xeroInvoices.id, xeroInvoiceId), eq(xeroInvoices.importId, importId)))
}

/** Say what an invoice actually is: a sale, a buy back, or neither. */
export async function setInvoiceBucket(
  importId: string, xeroInvoiceId: string, bucket: 'SALE' | 'BUYBACK' | 'NOT_A_SALE',
): Promise<void> {
  await db.update(xeroInvoices)
    .set({ bucket })
    .where(and(eq(xeroInvoices.id, xeroInvoiceId), eq(xeroInvoices.importId, importId)))
}

/** Remember that these two names are the same customer. */
export async function approveAlias(
  systemName: string, xeroName: string, actor: { id: string },
): Promise<void> {
  const key = normaliseName(xeroName)
  if (!key) return
  await db.insert(customerAliases).values({
    id: newId('cal'),
    systemName,
    xeroName,
    xeroKey: key,
    approvedById: actor.id,
  }).onConflictDoNothing()
}

/* ================= applying it ================= */

export interface ApplyResult {
  salesChanged: number
  fieldsChanged: number
}

/**
 * Write the changes somebody ticked, and nothing else.
 *
 * `approvals` is sale id → the fields approved for it. A sale missing from
 * the map is left alone, and a field missing from its list is left alone,
 * so rejecting is the default and approving is the act. Alex: "The user can
 * accept all, accept per sale, or reject individual changes."
 *
 * Every write is audited against the watch, which is where the history of a
 * piece is read, and the entry names the import so "why did this change?"
 * has an answer weeks later.
 */
export async function applyImport(
  importId: string,
  approvals: Record<string, XeroField[]>,
  actor: { id: string },
): Promise<ApplyResult> {
  const [header] = await db.select().from(xeroImports).where(eq(xeroImports.id, importId)).limit(1)
  if (!header) throw new NotFoundError('That import could not be found.')
  if (header.appliedAt) throw new ConflictError('That import has already been applied.')

  const review = await buildReview(importId)
  const rates = await getRateTable()
  let salesChanged = 0
  let fieldsChanged = 0

  await withTransaction(async () => {
    for (const invoice of review.invoices) {
      // A buy back is not a sale, so nothing on it is written to one.
      if (invoice.bucket !== 'SALE') continue

      for (const line of invoice.sales) {
        const wanted = approvals[line.saleId]
        if (!wanted || wanted.length === 0) continue
        const taking = line.changes.filter((change) => wanted.includes(change.field))
        if (taking.length === 0) continue

        const [current] = await db
          .select({
            id: sales.id,
            watchId: sales.watchId,
            invoiceNo: sales.invoiceNo,
            saleDate: sales.saleDate,
            customerName: sales.customerName,
            saleAmount: sales.saleAmount,
            saleCurrency: sales.saleCurrency,
            paymentStatus: sales.paymentStatus,
            paidOn: sales.paidOn,
            dueOn: sales.dueOn,
            stockNo: watches.stockNo,
            cost: watches.purchasePriceGbp,
          })
          .from(sales)
          .innerJoin(watches, eq(watches.id, sales.watchId))
          .where(and(eq(sales.id, line.saleId), liveSale()))
          .limit(1)
        if (!current) continue

        const patch: Record<string, unknown> = { updatedAt: new Date() }
        for (const change of taking) patch[change.field] = change.to

        // The amount drives the base figure, the profit and the margin, so
        // they are re-derived rather than left saying what the old amount
        // made. The cost is read, never written: it is ours.
        const movingMoney = taking.some((c) => c.field === 'saleAmount' || c.field === 'saleCurrency')
        if (movingMoney) {
          const currency = (patch['saleCurrency'] as CurrencyCode | undefined) ?? current.saleCurrency
          const amount = (patch['saleAmount'] as number | undefined) ?? current.saleAmount ?? 0
          const rate = currency === BASE_CURRENCY ? RATE_SCALE : rates[currency] ?? RATE_SCALE
          Object.assign(patch, saleMoney(amount, currency, rate, current.cost ?? 0))
        }

        await db.update(sales).set(patch).where(eq(sales.id, line.saleId))

        await recordAudit({
          entityType: 'Watch',
          entityId: current.watchId,
          action: 'UPDATE',
          actorId: actor.id,
          summary: `Reconciled stock ${current.stockNo} against Xero invoice ${invoice.invoiceNo} (${header.fileName})`,
          changes: Object.fromEntries(taking.map((change) => [
            FIELD_LABELS[change.field],
            { from: change.fromText, to: change.toText },
          ])),
        })

        await db.update(xeroLinks).set({ approved: true })
          .where(and(eq(xeroLinks.importId, importId), eq(xeroLinks.saleId, line.saleId)))
        salesChanged += 1
        fieldsChanged += taking.length
      }
    }

    // Which import last accounted for each sale, so the "no matching Xero
    // invoice" flag can be answered without re-reading the file.
    const seen = review.invoices.flatMap((invoice) => invoice.sales.map((sale) => sale.saleId))
    if (seen.length > 0) {
      await db.update(sales).set({ xeroSeenImportId: importId }).where(inArray(sales.id, seen))
    }

    await db.update(xeroImports)
      .set({ appliedAt: new Date(), appliedById: actor.id, updatedAt: new Date() })
      .where(eq(xeroImports.id, importId))
  })

  logger.info('xero import applied', { importId, salesChanged, fieldsChanged, actorId: actor.id })
  return { salesChanged, fieldsChanged }
}

/**
 * The last import, and the period it accounted for.
 *
 * For the always-on flag on the sales ledger: a sale inside those dates
 * that the import never saw is a sale the accounts have never heard of.
 * Null before the first import, which is when the flag has nothing to say.
 */
export async function lastImportWindow(): Promise<{ id: string; coversFrom: Date | null; coversTo: Date | null } | null> {
  const [row] = await db
    .select({ id: xeroImports.id, coversFrom: xeroImports.coversFrom, coversTo: xeroImports.coversTo })
    .from(xeroImports)
    .where(isNotNull(xeroImports.appliedAt))
    .orderBy(desc(xeroImports.appliedAt))
    .limit(1)
  return row ?? null
}

/** The imports, newest first, for the page to open on the last one. */
export async function recentImports(limit = 10) {
  return db.select({
    id: xeroImports.id,
    fileName: xeroImports.fileName,
    invoiceCount: xeroImports.invoiceCount,
    appliedAt: xeroImports.appliedAt,
    createdAt: xeroImports.createdAt,
  })
    .from(xeroImports)
    .orderBy(desc(xeroImports.createdAt))
    .limit(limit)
}

/** The exceptions as rows, for the export. */
export function exceptionRows(review: Review): string[][] {
  return [
    ['Kind', 'Invoice', 'Stock', 'Detail'],
    ...review.exceptions.map((row) => [
      row.kind,
      row.invoiceNo ?? '',
      row.stockNo === null ? '' : String(row.stockNo),
      row.detail,
    ]),
  ]
}

export { searchableText }
