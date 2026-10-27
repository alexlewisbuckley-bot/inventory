import { CURRENCIES, type CurrencyCode, type PaymentStatus } from './enums'

/**
 * Reading a Xero Sales Invoices export.
 *
 * Alex: "We reconciled 14 sales against 12 Xero invoices by hand today and 11
 * of them had at least one error. That needs to stop."
 *
 * The rule the whole feature turns on: Xero is the source of truth for the
 * invoice number, the invoice date, the customer name, the amount, the
 * currency and the payment status. The system owns everything else — stock
 * number, reference, brand, cost, sold-by, channel, notes — and nothing in
 * this file reads any of those, because nothing here is allowed to.
 *
 * Deliberately pure. It takes the rows a spreadsheet reader already produced
 * and returns invoices; it never touches the database and never decides what
 * to write. That is what lets the whole of the hard part — the column
 * guessing, the statuses, the grouping — be tested against real exports
 * without one.
 *
 * It is also the seam for the API. Alex: "design the matching layer so a
 * direct Xero API sync can replace the file later without rewriting it." A
 * Xero API response becomes `XeroInvoice[]` and everything downstream carries
 * on unchanged.
 */

/** One line on an invoice. A Xero export is one row per line. */
export interface XeroLine {
  description: string
  /** The line's own amount in the invoice currency, in minor units. */
  amount: number | null
  quantity: number | null
}

export interface XeroInvoice {
  invoiceNo: string
  contactName: string
  /** Midnight UTC on the invoice's calendar day, as sale dates are stored. */
  invoiceDate: Date | null
  dueDate: Date | null
  /** When Xero says the money actually arrived. */
  paidDate: Date | null
  currency: CurrencyCode
  /** The invoice total in its own currency, in minor units. */
  total: number
  status: XeroStatus
  /** Xero's own reference field, which is where a stock number often hides. */
  reference: string
  lines: XeroLine[]
  /** Row numbers in the file, so an exceptions report can point at them. */
  rows: number[]
}

export type XeroStatus = 'PAID' | 'AWAITING_PAYMENT' | 'OVERDUE' | 'VOIDED' | 'DRAFT'

/**
 * Xero's statuses, mapped onto ours.
 *
 * Alex: "'Awaiting payment' must show on every unpaid sale, not just some."
 * That is the bug this map exists to kill — unpaid is unpaid whichever of
 * Xero's three words it arrived under, so all three land on PENDING or
 * OVERDUE and never on PAID.
 *
 * VOIDED and DRAFT have no payment status of their own: a voided invoice
 * unlinks and flags the sale, and a draft is not yet a promise to pay.
 * Returning null keeps them out of the payment field entirely rather than
 * guessing a value for them.
 */
export function paymentStatusFor(status: XeroStatus): PaymentStatus | null {
  switch (status) {
    case 'PAID': return 'PAID'
    case 'AWAITING_PAYMENT': return 'PENDING'
    case 'OVERDUE': return 'OVERDUE'
    case 'VOIDED': return null
    case 'DRAFT': return null
  }
}

/**
 * Xero writes its statuses several ways depending on which export you take —
 * "AUTHORISED" in the API shape, "Awaiting Payment" in the UI export — and
 * an unrecognised one must never quietly become PAID.
 */
export function readStatus(raw: string): XeroStatus {
  const text = raw.trim().toUpperCase().replace(/[\s_-]+/g, ' ')
  if (!text) return 'DRAFT'
  if (text === 'VOIDED' || text === 'VOID' || text === 'DELETED') return 'VOIDED'
  if (text === 'DRAFT' || text === 'SUBMITTED') return 'DRAFT'
  if (text === 'OVERDUE') return 'OVERDUE'
  if (text === 'PAID') return 'PAID'
  if (text.includes('AWAITING')) return 'AWAITING_PAYMENT'
  // "AUTHORISED" is Xero's word for an issued invoice that is not yet paid,
  // which is the same thing the UI calls Awaiting Payment.
  if (text === 'AUTHORISED' || text === 'AUTHORIZED') return 'AWAITING_PAYMENT'
  return 'DRAFT'
}

/**
 * Which column is which, found by name rather than by position.
 *
 * Xero's export columns move with the report options somebody ticked, so
 * reading column 3 is a guarantee of reading the wrong thing eventually.
 * Each field lists the headings seen in the wild, longest and most specific
 * first, matched on a normalised heading so "Invoice Number", "InvoiceNumber"
 * and "invoice no." are one thing.
 */
const HEADINGS: Record<string, string[]> = {
  invoiceNo: ['invoicenumber', 'invoiceno', 'invoice', 'number', 'billnumber'],
  contactName: ['contactname', 'contact', 'customername', 'customer', 'to', 'name'],
  invoiceDate: ['invoicedate', 'date', 'issuedate'],
  dueDate: ['duedate'],
  // Xero names this column differently depending on the export; all three
  // mean the day the invoice was settled.
  paidDate: ['fullypaiddate', 'paiddate', 'datepaid'],
  currency: ['currencycode', 'currency'],
  total: ['total', 'invoicetotal', 'grosstotal', 'totalamount', 'amount'],
  status: ['status', 'invoicestatus'],
  reference: ['reference', 'ref'],
  description: ['description', 'item', 'details', 'linedescription'],
  lineAmount: ['lineamount', 'amount', 'linetotal'],
  quantity: ['quantity', 'qty'],
}

const normalise = (heading: string) => heading.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The header row's columns, by field.
 *
 * A heading is claimed by the first field that wants it, in the order the
 * fields are declared, so "Amount" goes to `total` only when there is no
 * better candidate and never steals the column a more specific heading has
 * already taken.
 */
export function readHeader(header: string[]): Record<string, number> {
  const found: Record<string, number> = {}
  const taken = new Set<number>()
  const cells = header.map(normalise)

  for (const [field, names] of Object.entries(HEADINGS)) {
    for (const name of names) {
      const index = cells.findIndex((cell, i) => cell === name && !taken.has(i))
      if (index >= 0) {
        found[field] = index
        taken.add(index)
        break
      }
    }
  }
  return found
}

/** A date cell, as midnight UTC on the day it names. */
export function readDate(raw: string): Date | null {
  const text = raw.trim()
  if (!text) return null

  // ISO first: readTable already normalises Excel date cells to this, so it
  // is the common case and the only unambiguous one.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return utc(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  // Then day-first, which is what Xero writes for a UK or UAE organisation.
  // Month-first is not attempted: there is no way to tell 03/04 apart, and a
  // date silently read the wrong way round is exactly the kind of error this
  // feature exists to catch.
  const slashed = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(text)
  if (slashed) {
    const year = Number(slashed[3])
    return utc(year < 100 ? 2000 + year : year, Number(slashed[2]), Number(slashed[1]))
  }

  // "14 Oct 2026" and "14 October 2026", which is Xero's long format.
  const named = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(text)
  if (named) {
    const month = MONTHS.indexOf(named[2]!.slice(0, 3).toLowerCase())
    if (month >= 0) return utc(Number(named[3]), month + 1, Number(named[1]))
  }
  return null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function utc(year: number, month: number, day: number): Date | null {
  if (!year || !month || !day || month > 12 || day > 31) return null
  return new Date(Date.UTC(year, month - 1, day))
}

/**
 * A money cell in minor units.
 *
 * Rounded rather than truncated, and done on a string that has had its
 * thousands separators and currency symbols taken off first. Parsing
 * "1,015,424.50" as a float and multiplying is how a cent goes missing, and
 * a cent is the whole point of the allocation step further on.
 */
export function readMoney(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  const negative = /^\(.*\)$/.test(text)
  const cleaned = text
    .replace(/^\(|\)$/g, '')
    .replace(new RegExp(`\\b(?:${CURRENCIES.join('|')})\\b`, 'gi'), '')
    .replace(/[£$€¥,\s]/g, '')
  if (cleaned === '' || cleaned === '-') return null
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return null
  const minor = Math.round(Math.abs(parsed) * 100)
  return negative ? -minor : minor
}

/** A currency cell, defaulting to the organisation's base. */
export function readCurrency(raw: string, base: CurrencyCode): CurrencyCode {
  const text = raw.trim().toUpperCase()
  return (CURRENCIES as readonly string[]).includes(text) ? text as CurrencyCode : base
}

/**
 * A Xero export, as invoices.
 *
 * One row per line item, so rows are grouped by invoice number and the
 * invoice's own fields are taken from the first row that states them — Xero
 * leaves the header fields blank on a second line rather than repeating
 * them, and a blank must not overwrite what the first line said.
 *
 * The total is Xero's own stated total where the export carries one. Only
 * where it does not is it summed from the lines, because the stated total is
 * the figure the customer was asked for and a sum of lines can miss rounding,
 * discounts or tax.
 */
export function parseXeroExport(
  table: string[][],
  { base = 'AED' as CurrencyCode } = {},
): { invoices: XeroInvoice[]; skipped: number } {
  const headerAt = table.findIndex((row) => Object.keys(readHeader(row)).length >= 3)
  if (headerAt < 0) return { invoices: [], skipped: table.length }

  const at = readHeader(table[headerAt]!)
  const cell = (row: string[], field: string) => {
    const index = at[field]
    return index === undefined ? '' : (row[index] ?? '')
  }

  const byNumber = new Map<string, XeroInvoice>()
  // Totals summed from the lines, kept apart so a stated total always wins.
  const summed = new Map<string, number>()
  const stated = new Set<string>()
  let skipped = 0

  for (let r = headerAt + 1; r < table.length; r += 1) {
    const row = table[r]!
    const invoiceNo = cell(row, 'invoiceNo').trim()
    const lineAmount = readMoney(cell(row, 'lineAmount'))
    const description = cell(row, 'description').trim()

    // A row with no invoice number is a total line, a blank separator or a
    // note. Counted rather than dropped quietly, so the import can say how
    // much of the file it did not understand.
    if (!invoiceNo) {
      if (row.some((value) => value.trim())) skipped += 1
      continue
    }

    const existing = byNumber.get(invoiceNo)
    const invoice: XeroInvoice = existing ?? {
      invoiceNo,
      contactName: '',
      invoiceDate: null,
      dueDate: null,
      paidDate: null,
      currency: base,
      total: 0,
      status: 'DRAFT',
      reference: '',
      lines: [],
      rows: [],
    }

    // First statement of each field wins; a blank on a continuation row is
    // Xero not repeating itself, not Xero saying the field is empty.
    if (!invoice.contactName) invoice.contactName = cell(row, 'contactName').trim()
    if (!invoice.reference) invoice.reference = cell(row, 'reference').trim()
    if (!invoice.invoiceDate) invoice.invoiceDate = readDate(cell(row, 'invoiceDate'))
    if (!invoice.dueDate) invoice.dueDate = readDate(cell(row, 'dueDate'))
    if (!invoice.paidDate) invoice.paidDate = readDate(cell(row, 'paidDate'))
    if (!existing) {
      invoice.currency = readCurrency(cell(row, 'currency'), base)
      invoice.status = readStatus(cell(row, 'status'))
    }

    const total = at['total'] === at['lineAmount'] ? null : readMoney(cell(row, 'total'))
    if (total !== null && !stated.has(invoiceNo)) {
      invoice.total = total
      stated.add(invoiceNo)
    }
    if (lineAmount !== null) summed.set(invoiceNo, (summed.get(invoiceNo) ?? 0) + lineAmount)

    if (description || lineAmount !== null) {
      invoice.lines.push({
        description,
        amount: lineAmount,
        quantity: readMoney(cell(row, 'quantity')) === null
          ? null
          : Number(cell(row, 'quantity').trim()),
      })
    }
    invoice.rows.push(r + 1)
    byNumber.set(invoiceNo, invoice)
  }

  for (const [invoiceNo, invoice] of byNumber) {
    if (!stated.has(invoiceNo)) invoice.total = summed.get(invoiceNo) ?? 0
  }
  return { invoices: [...byNumber.values()], skipped }
}

/**
 * Everything on an invoice that a stock number could be hiding in.
 *
 * Alex's second matching tier is "stock number found in the Xero reference,
 * line description or notes", so the three are searched as one piece of text
 * rather than one at a time.
 */
export function searchableText(invoice: XeroInvoice): string {
  return [invoice.reference, ...invoice.lines.map((line) => line.description)]
    .filter(Boolean)
    .join(' ')
}
