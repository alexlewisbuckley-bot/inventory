import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import {
  brokerages, buybackCharges, buybacks, customerAliases, customers, sales, watches,
  xeroImports, xeroInvoices, xeroLinks,
} from '../db/schema'
import { newId } from '@/lib/ids'
import { NotFoundError, ConflictError } from '@/lib/errors'
import { BASE_CURRENCY, type CurrencyCode } from '@/lib/enums'
import { RATE_SCALE, type RateTable } from '@/lib/currency'
import { getRateTable } from './fx-service'
import { recordAudit } from './audit'
import { readTable } from './import-service'
import { readXeroScreenshots, isScreenshot } from './xero-vision'
import { saleMoney } from './watch-service'
import { logger } from '@/lib/logger'
import {
  parseXeroExport, searchableText, type XeroInvoice,
} from '@/lib/xero-invoice'
import {
  matchInvoices, looksLikeBuyBack, normaliseName, nearestInvoice,
  type SaleCandidate, type MatchTier, type MatchedSale, type CandidateKind, type NearMiss,
} from '@/lib/xero-match'
import { allocate, allocationBalances } from '@/lib/xero-allocate'
import {
  proposeChanges, exceptionsFor, FIELD_LABELS,
  type ProposedChange, type ReconcileException, type SaleSnapshot, type XeroField,
} from '@/lib/xero-diff'
import { feeInBase } from './brokerage-service'

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
  files: Array<{ name: string; mimeType?: string; buffer: ArrayBuffer }>,
  actor: { id: string },
): Promise<{
  importId: string
  invoiceCount: number
  matchedCount: number
  skippedRows: number
  /** True where the invoices were read out of pictures rather than a file. */
  fromScreenshots: boolean
}> {
  if (files.length === 0) throw new ConflictError('Choose a Xero export or a screenshot.')

  /*
   * Three ways in, one shape out.
   *
   * Alex asked for screenshots alongside the export, and the matching
   * layer was built for exactly this: whatever produced them, the rest of
   * the feature receives `XeroInvoice[]` and cannot tell the difference.
   * A Xero API sync will be the third, and will not change a line below.
   */
  const shots = files.filter((file) => isScreenshot({ name: file.name, type: file.mimeType }))
  const sheet = files.find((file) => !isScreenshot({ name: file.name, type: file.mimeType }))

  let invoices: XeroInvoice[]
  let skipped: number
  const fromScreenshots = shots.length > 0 && !sheet

  if (fromScreenshots) {
    const reading = await readXeroScreenshots(
      shots.map((file) => ({
        name: file.name,
        mimeType: file.mimeType ?? mimeFromName(file.name),
        buffer: file.buffer,
      })),
      BASE_CURRENCY,
    )
    if (reading.error) throw new ConflictError(reading.error)
    invoices = reading.invoices
    // Invoices the reading could not use — a total it could not make out,
    // a row cut off at the edge of the picture. Reported in the same place
    // a file's unreadable rows are, because they mean the same thing: this
    // much of what you gave me did not come through.
    skipped = reading.dropped
    if (invoices.length === 0) {
      throw new ConflictError(
        'No invoices could be read from those screenshots. Make sure the invoice number, the total and the status are all visible, or drop the CSV export instead.',
      )
    }
  } else {
    const file = sheet ?? files[0]!
    const table = await readTable(file)
    const parsed = parseXeroExport(table, { base: BASE_CURRENCY })
    invoices = parsed.invoices
    skipped = parsed.skipped
    if (invoices.length === 0) {
      throw new ConflictError('No invoices could be read from that file. Export the Sales Invoices list from Xero as CSV or XLSX.')
    }
  }
  const fileName = fromScreenshots
    ? `${shots.length} ${shots.length === 1 ? 'screenshot' : 'screenshots'}`
    : (sheet ?? files[0]!).name

  // Money is held in 32-bit integers throughout, as every other amount in
  // the system is. A figure past that is a misread column — a reference
  // number or a date landing in the total — far more often than it is a
  // real invoice, and either way it must say so rather than fail with the
  // driver's own error about a portal parameter.
  const tooBig = invoices.find((invoice) => Math.abs(invoice.total) > 2_147_483_647)
  if (tooBig) {
    throw new ConflictError(
      `Invoice ${tooBig.invoiceNo} reads as ${(tooBig.total / 100).toLocaleString('en-GB')} ${tooBig.currency}, which is too large to be a total. Check the amount it was read from.`,
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
      fileName,
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
        /*
         * What this invoice appears to be for. A suggestion, never a
         * decision: the user confirms it.
         *
         * An invoice that matched a buy-back charge is for a buy-back,
         * whatever its wording — saying so is more honest than calling it
         * a sale, and is now safe to say, because the bucket no longer
         * decides whether anything gets written.
         */
        bucket: bucketFor(invoice, linkedAt.get(at)?.sales ?? []),
      })

      const match = linkedAt.get(at)
      if (!match) continue
      await writeLinks({ importId, invoiceRowId, invoice, matches: match.sales, byId })
    }
  })

  logger.info('xero import staged', {
    importId, invoices: invoices.length, matched: matched.length,
    fromScreenshots, actorId: actor.id,
  })
  return {
    importId,
    invoiceCount: invoices.length,
    matchedCount: matched.reduce((n, m) => n + m.sales.length, 0),
    skippedRows: skipped,
    fromScreenshots,
  }
}

/**
 * What an invoice is for, as far as the file can tell.
 *
 * What it matched comes first, because a charge it was paired with is
 * better evidence than the words on it. Failing that, the words.
 */
function bucketFor(invoice: XeroInvoice, matched: MatchedSale[]): string {
  if (matched.some((m) => m.kind === 'BUYBACK')) return 'BUYBACK'
  if (matched.length > 0) return 'SALE'
  return looksLikeBuyBack(invoice) ? 'BUYBACK' : 'SALE'
}

/** The type a dropped file did not declare, from what it is called. */
function mimeFromName(name: string): string {
  if (/\.png$/i.test(name)) return 'image/png'
  if (/\.webp$/i.test(name)) return 'image/webp'
  if (/\.gif$/i.test(name)) return 'image/gif'
  return 'image/jpeg'
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
      ...targetColumns(share.item.kind, share.item.saleId),
      tier: share.item.tier,
      allocated: share.amount,
    }).onConflictDoNothing()
  }
}

/**
 * Which column a link's target goes in.
 *
 * Three typed columns rather than one untyped id, so the database still
 * knows the link points at something real. Exactly one is ever set, which
 * a check constraint enforces.
 */
function targetColumns(kind: CandidateKind, id: string) {
  return {
    kind,
    saleId: kind === 'SALE' ? id : null,
    brokerageId: kind === 'COMMISSION' ? id : null,
    buybackChargeId: kind === 'BUYBACK' ? id : null,
  }
}

/** Whichever of the three a link points at. */
function targetOf(link: { saleId: string | null; brokerageId: string | null; buybackChargeId: string | null }): string {
  return link.saleId ?? link.brokerageId ?? link.buybackChargeId ?? ''
}

interface LiveSale {
  id: string
  /**
   * Which of the three books this row came out of.
   *
   * Alex: "there are quite a few sales that are not linking, and I think
   * it's due to commissions not being tracked and buybacks." He was
   * right, and it was not a tolerance problem — this query only ever read
   * the sales table, so an invoice for a brokered fee or a buy-back
   * charge had nothing it could match and landed in "in Xero, no sale"
   * every time.
   */
  kind: CandidateKind
  /** What to call it on the review screen. */
  label: string
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
  /** A sale always has one; a commission may; a buy-back charge never does. */
  watchId: string | null
  purchasePriceGbp: number | null
}

/**
 * Everything in the book an invoice could be for.
 *
 * Three queries rather than one: a watch sold, a fee brokered on somebody
 * else's watch, and a charge on money lent against one. They are three
 * tables with three shapes and one thing in common — each was invoiced out
 * of Xero — so they are flattened into one candidate shape here and the
 * matcher never learns there was more than one source.
 */
async function liveSaleCandidates(): Promise<LiveSale[]> {
  const [sold, brokered, charges] = await Promise.all([
    db.select({
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
      model: watches.model,
    })
      .from(sales)
      .innerJoin(watches, eq(watches.id, sales.watchId))
      .where(liveSale()),

    db.select({
      id: brokerages.id,
      description: brokerages.description,
      // The reference is the number we have for it, and it is where a
      // Xero invoice number gets written when somebody has one.
      reference: brokerages.reference,
      // Who it was sold to, which is the name Xero's contact will match.
      soldTo: brokerages.soldTo,
      /*
       * The linked customer, as a fallback.
       *
       * `soldTo` is free text and is very often empty — the commission in
       * the book right now has none — which left the name tier with
       * nothing to compare and made the fee unmatchable by anything but
       * its reference. Where the fee points at a customer record, that
       * record's name is the better answer anyway.
       */
      customerFirst: customers.firstName,
      customerLast: customers.lastName,
      customerCompany: customers.company,
      brokeredOn: brokerages.brokeredOn,
      feeAmount: brokerages.feeAmount,
      feeBase: brokerages.feeBase,
      feeCurrency: brokerages.feeCurrency,
      paymentStatus: brokerages.paymentStatus,
      watchId: brokerages.watchId,
      stockNo: watches.stockNo,
    })
      .from(brokerages)
      // Left, not inner: the common commission is a fee on a watch that
      // was never ours, and an inner join would drop every one of them.
      .leftJoin(watches, eq(watches.id, brokerages.watchId))
      .leftJoin(customers, eq(customers.id, brokerages.customerId))
      .where(and(isNull(brokerages.voidedAt), isNull(brokerages.deletedAt))),

    db.select({
      id: buybackCharges.id,
      dueOn: buybackCharges.dueOn,
      amount: buybackCharges.amount,
      amountBase: buybackCharges.amountBase,
      currency: buybackCharges.currency,
      paymentStatus: buybackCharges.paymentStatus,
      paidOn: buybackCharges.paidOn,
      invoiceNo: buybackCharges.invoiceNo,
      chargeKind: buybackCharges.kind,
      // The customer and the reference live on the loan, not the charge.
      customerName: buybacks.customerName,
      reference: buybacks.reference,
    })
      .from(buybackCharges)
      .innerJoin(buybacks, eq(buybacks.id, buybackCharges.buybackId))
      .where(and(isNull(buybackCharges.voidedAt), isNull(buybacks.deletedAt))),
  ])

  return [
    ...sold.map((row) => ({
      ...row,
      kind: 'SALE' as const,
      label: `Stock ${row.stockNo}`,
      // A sale booked before the original-amount column existed has only
      // its base figure. Using that rather than null keeps it matchable.
      saleAmount: row.saleAmount ?? row.saleAmountGbp,
      amountBase: row.saleAmountGbp,
    })),

    ...brokered.map((row) => ({
      id: row.id,
      kind: 'COMMISSION' as const,
      label: row.description || 'Commission',
      stockNo: row.stockNo,
      invoiceNo: row.reference,
      saleDate: row.brokeredOn,
      customerName: row.soldTo?.trim()
        || row.customerCompany?.trim()
        || [row.customerFirst, row.customerLast].filter(Boolean).join(' ').trim()
        || null,
      saleAmount: row.feeAmount,
      amountBase: row.feeBase,
      saleCurrency: row.feeCurrency,
      paymentStatus: row.paymentStatus,
      // A fee carries no paid date and no due date of its own.
      paidOn: null,
      dueOn: null,
      channel: 'COMMISSION',
      watchId: row.watchId,
      // A fee has no cost under it, by definition.
      purchasePriceGbp: null,
    })),

    ...charges.map((row) => ({
      id: row.id,
      kind: 'BUYBACK' as const,
      label: `Buy-back ${row.chargeKind.toLowerCase()}${row.customerName ? ` — ${row.customerName}` : ''}`,
      stockNo: null,
      // Its own number where it has one, falling back to the loan's
      // reference for a charge that has never been invoiced.
      invoiceNo: row.invoiceNo ?? row.reference,
      // The day it falls due is the day it would be invoiced on.
      saleDate: row.dueOn,
      customerName: row.customerName,
      saleAmount: row.amount,
      amountBase: row.amountBase,
      saleCurrency: row.currency,
      paymentStatus: row.paymentStatus,
      paidOn: row.paidOn,
      dueOn: row.dueOn,
      channel: 'BUYBACK',
      watchId: null,
      purchasePriceGbp: null,
    })),
  ]
}

const toCandidate = (sale: LiveSale): SaleCandidate => ({
  id: sale.id,
  kind: sale.kind,
  stockNo: sale.stockNo,
  invoiceNo: sale.invoiceNo,
  customerName: sale.customerName,
  saleDate: sale.saleDate,
  amountBase: sale.amountBase,
})

const toSnapshot = (sale: LiveSale): SaleSnapshot => ({
  id: sale.id,
  kind: sale.kind,
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
  /** Which of the three books this row lives in. */
  kind: CandidateKind
  /** What to call it: "Stock 1366", a fee's description, a charge. */
  label: string
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
  /** Rows of the book — of any kind — no invoice in this file accounted for. */
  unmatchedSales: Array<{
    saleId: string; kind: CandidateKind; label: string; stockNo: number | null
    invoiceNo: string | null; customerName: string | null; saleDate: Date
    /** As invoiced, and in base — the two figures a row is reconciled on. */
    amount: number | null; currency: CurrencyCode; amountBase: number
    /** The closest invoice in the file, and what kept it out. */
    nearest: NearMiss | null
  }>
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
    db.select({
      xeroKey: customerAliases.xeroKey,
      systemName: customerAliases.systemName,
      xeroName: customerAliases.xeroName,
    }).from(customerAliases),
  ])
  const toBase = toBaseWith(rates)
  const aliasPairs = aliases.map((a) => ({ systemName: a.systemName, xeroName: a.xeroName }))

  const byId = new Map(candidates.map((sale) => [sale.id, sale]))
  const linksByInvoice = new Map<string, typeof linkRows>()
  for (const link of linkRows) {
    linksByInvoice.set(link.xeroInvoiceId, [...(linksByInvoice.get(link.xeroInvoiceId) ?? []), link])
  }
  const knownAlias = new Set(aliases.map((a) => a.xeroKey))
  const linkedSaleIds = new Set(linkRows.map(targetOf))
  const claimedInvoiceIds = new Set(linkRows.map((link) => link.xeroInvoiceId))
  const freeInvoices = invoiceRows
    .filter((row) => !claimedInvoiceIds.has(row.id))
    .map(rowToInvoice)
  const exceptions: ReconcileException[] = []

  const invoices: ReviewInvoice[] = invoiceRows.map((row) => {
    const asInvoice = rowToInvoice(row)
    const links = linksByInvoice.get(row.id) ?? []
    const rate = row.fxRate ?? (row.currency === BASE_CURRENCY ? RATE_SCALE : rates[row.currency] ?? RATE_SCALE)

    const reviewSales: ReviewSale[] = links.flatMap((link) => {
      const sale = byId.get(targetOf(link))
      if (!sale) return []
      const found = exceptionsFor(toSnapshot(sale), asInvoice, link.allocated)
      exceptions.push(...found)
      return [{
        saleId: sale.id,
        kind: sale.kind,
        label: sale.label,
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
      kind: sale.kind,
      label: sale.label,
      stockNo: sale.stockNo,
      invoiceNo: sale.invoiceNo,
      customerName: sale.customerName,
      saleDate: sale.saleDate,
      amount: sale.saleAmount,
      currency: sale.saleCurrency,
      amountBase: sale.amountBase,
      // Measured against the invoices nothing claimed, since an invoice
      // already spoken for is not an answer to "why did this not match".
      nearest: nearestInvoice(toCandidate(sale), freeInvoices, { toBase, aliases: aliasPairs }),
    }))
    // Newest first, which is the order a Xero export is worked through.
    // Returned in candidate order it came out as every sale, then every
    // commission, then every charge — three lists to scan instead of one.
    .sort((a, b) => b.saleDate.getTime() - a.saleDate.getTime())
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
/** Whichever of the three columns holds this target, for a lookup. */
const isTarget = (id: string) =>
  sql`coalesce(${xeroLinks.saleId}, ${xeroLinks.brokerageId}, ${xeroLinks.buybackChargeId}) = ${id}`

export async function linkSale(
  importId: string, xeroInvoiceId: string, saleId: string, kind: CandidateKind = 'SALE',
): Promise<void> {
  const [invoice] = await db.select().from(xeroInvoices)
    .where(and(eq(xeroInvoices.id, xeroInvoiceId), eq(xeroInvoices.importId, importId))).limit(1)
  if (!invoice) throw new NotFoundError('That invoice is not part of this import.')

  await withTransaction(async () => {
    await db.delete(xeroLinks)
      .where(and(eq(xeroLinks.importId, importId), isTarget(saleId)))
    await db.insert(xeroLinks).values({
      id: newId('xlk'),
      importId,
      xeroInvoiceId,
      ...targetColumns(kind, saleId),
      tier: 'manual',
      allocated: 0,
    })
  })
  await reallocate(xeroInvoiceId)
}

export async function unlinkSale(importId: string, saleId: string): Promise<void> {
  const [link] = await db.select().from(xeroLinks)
    .where(and(eq(xeroLinks.importId, importId), isTarget(saleId))).limit(1)
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

  /*
   * The base figure, for the same reason the first allocation uses it —
   * and now from whichever of the three books each target lives in, since
   * an invoice can cover a watch and a fee at once.
   */
  const weightOf = new Map<string, number>()
  const saleIds = links.map((l) => l.saleId).filter((id): id is string => id !== null)
  const feeIds = links.map((l) => l.brokerageId).filter((id): id is string => id !== null)
  const chargeIds = links.map((l) => l.buybackChargeId).filter((id): id is string => id !== null)
  if (saleIds.length) {
    for (const row of await db.select({ id: sales.id, w: sales.saleAmountGbp })
      .from(sales).where(inArray(sales.id, saleIds))) weightOf.set(row.id, row.w ?? 0)
  }
  if (feeIds.length) {
    for (const row of await db.select({ id: brokerages.id, w: brokerages.feeBase })
      .from(brokerages).where(inArray(brokerages.id, feeIds))) weightOf.set(row.id, row.w ?? 0)
  }
  if (chargeIds.length) {
    for (const row of await db.select({ id: buybackCharges.id, w: buybackCharges.amountBase })
      .from(buybackCharges).where(inArray(buybackCharges.id, chargeIds))) weightOf.set(row.id, row.w ?? 0)
  }

  const shares = allocate(invoice.total, links.map((link) => ({
    item: link, weight: weightOf.get(targetOf(link)) ?? 0,
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
 * Write Xero's answer onto a brokered fee.
 *
 * The abstract field names the review screen uses map onto this table's
 * own columns here, in one place, so nothing upstream has to know that a
 * commission calls its customer `soldTo` and its date `brokeredOn`.
 */
async function applyToCommission(
  id: string, taking: ProposedChange[], rates: RateTable,
): Promise<{ entityType: string; entityId: string; what: string } | null> {
  const [current] = await db.select().from(brokerages).where(eq(brokerages.id, id)).limit(1)
  if (!current || current.voidedAt || current.deletedAt) return null

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  for (const change of taking) {
    if (change.field === 'invoiceNo') patch['reference'] = change.to
    if (change.field === 'saleDate') patch['brokeredOn'] = change.to
    if (change.field === 'customerName') patch['soldTo'] = change.to
    if (change.field === 'paymentStatus') patch['paymentStatus'] = change.to
    if (change.field === 'saleAmount') patch['feeAmount'] = change.to
    if (change.field === 'saleCurrency') patch['feeCurrency'] = change.to
  }

  // The fee in base is what every report adds up, so it is re-derived
  // rather than left stating what the old fee came to.
  if (taking.some((c) => c.field === 'saleAmount' || c.field === 'saleCurrency')) {
    const currency = (patch['feeCurrency'] as CurrencyCode | undefined) ?? current.feeCurrency
    const amount = (patch['feeAmount'] as number | undefined) ?? current.feeAmount
    const { feeBase, feeFxRate } = feeInBase(amount, currency, rates)
    patch['feeBase'] = feeBase
    patch['feeFxRate'] = feeFxRate
  }

  await db.update(brokerages).set(patch).where(eq(brokerages.id, id))
  return { entityType: 'Brokerage', entityId: id, what: `commission "${current.description}"` }
}

/**
 * Write Xero's answer onto a buy-back charge.
 *
 * Only the money and the status. The date a charge falls due comes off the
 * loan's own schedule, and the customer off the loan — letting an invoice
 * state either would quietly reschedule somebody's loan from the accounts.
 */
async function applyToCharge(
  id: string, taking: ProposedChange[], rates: RateTable,
): Promise<{ entityType: string; entityId: string; what: string } | null> {
  const [current] = await db.select().from(buybackCharges).where(eq(buybackCharges.id, id)).limit(1)
  if (!current || current.voidedAt) return null

  const patch: Record<string, unknown> = {}
  for (const change of taking) {
    if (change.field === 'invoiceNo') patch['invoiceNo'] = change.to
    if (change.field === 'paymentStatus') patch['paymentStatus'] = change.to
    if (change.field === 'paidOn') patch['paidOn'] = change.to
    if (change.field === 'saleAmount') patch['amount'] = change.to
    if (change.field === 'saleCurrency') patch['currency'] = change.to
  }

  if (taking.some((c) => c.field === 'saleAmount' || c.field === 'saleCurrency')) {
    const currency = (patch['currency'] as CurrencyCode | undefined) ?? current.currency
    const amount = (patch['amount'] as number | undefined) ?? current.amount
    const rate = currency === BASE_CURRENCY ? RATE_SCALE : rates[currency] ?? RATE_SCALE
    patch['amountBase'] = currency === BASE_CURRENCY
      ? amount
      : Math.round((amount * RATE_SCALE) / rate)
    patch['fxRate'] = rate
  }
  if (Object.keys(patch).length === 0) return null

  await db.update(buybackCharges).set(patch).where(eq(buybackCharges.id, id))
  return { entityType: 'Buyback', entityId: current.buybackId, what: 'buy-back charge' }
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
      /*
       * Only an invoice the user has said is none of ours is skipped.
       *
       * This used to skip everything that was not bucketed SALE, which
       * was right when a buy-back was something the reconcile could only
       * put in a pending pile: "not a sale" meant "do not invent a sale
       * from this". Once a buy-back charge became linkable, the same line
       * started refusing to write the very thing it had just been linked
       * to — an invoice marked Buy Back could be matched to its charge,
       * show the changes on screen, and apply nothing at all.
       *
       * The per-kind writers already put each change in the right table,
       * so the bucket no longer needs to gate that. It only answers
       * whether this invoice is ours to act on.
       */
      if (invoice.bucket === 'NOT_A_SALE') continue

      for (const line of invoice.sales) {
        const wanted = approvals[line.saleId]
        if (!wanted || wanted.length === 0) continue
        const taking = line.changes.filter((change) => wanted.includes(change.field))
        if (taking.length === 0) continue

        /*
         * A commission and a buy-back charge live in their own tables with
         * their own column names, so each is written by its own small
         * function rather than by widening the sale's.
         *
         * They are audited against the fee and the loan rather than
         * against a watch, because that is where their history is read —
         * and a fee on somebody else's watch has no watch of ours to
         * write a trail on.
         */
        if (line.kind !== 'SALE') {
          const wrote = line.kind === 'COMMISSION'
            ? await applyToCommission(line.saleId, taking, rates)
            : await applyToCharge(line.saleId, taking, rates)
          if (!wrote) continue
          await recordAudit({
            entityType: wrote.entityType,
            entityId: wrote.entityId,
            action: 'UPDATE',
            actorId: actor.id,
            summary: `Reconciled ${wrote.what} against Xero invoice ${invoice.invoiceNo} (${header.fileName})`,
            changes: Object.fromEntries(taking.map((change) => [
              FIELD_LABELS[change.field],
              { from: change.fromText, to: change.toText },
            ])),
          })
          await db.update(xeroLinks).set({ approved: true })
            .where(and(eq(xeroLinks.importId, importId), isTarget(line.saleId)))
          salesChanged += 1
          fieldsChanged += taking.length
          continue
        }

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
          .where(and(eq(xeroLinks.importId, importId), isTarget(line.saleId)))
        salesChanged += 1
        fieldsChanged += taking.length
      }
    }

    /*
     * Which import last accounted for each row, so the "no matching Xero
     * invoice" flag can be answered without re-reading the file.
     *
     * All three books, not just sales. Marking only sales left every
     * commission and every buy-back charge reading "Not in Xero" for
     * good, however well it had just reconciled — which is what Alex saw
     * on the ledger straight after an import.
     */
    const seenOf = (kind: CandidateKind) => review.invoices
      .flatMap((invoice) => invoice.sales.filter((s) => s.kind === kind).map((s) => s.saleId))

    const seenSales = seenOf('SALE')
    if (seenSales.length > 0) {
      await db.update(sales).set({ xeroSeenImportId: importId }).where(inArray(sales.id, seenSales))
    }
    const seenFees = seenOf('COMMISSION')
    if (seenFees.length > 0) {
      await db.update(brokerages).set({ xeroSeenImportId: importId })
        .where(inArray(brokerages.id, seenFees))
    }
    const seenCharges = seenOf('BUYBACK')
    if (seenCharges.length > 0) {
      await db.update(buybackCharges).set({ xeroSeenImportId: importId })
        .where(inArray(buybackCharges.id, seenCharges))
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
