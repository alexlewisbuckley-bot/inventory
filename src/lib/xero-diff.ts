import type { CurrencyCode, PaymentStatus } from './enums'
import { paymentStatusFor, type XeroInvoice } from './xero-invoice'
import { isPlaceholderInvoiceNo, normaliseInvoiceNo, normaliseName } from './xero-match'

/**
 * What an invoice would change about a sale, before anything is written.
 *
 * Alex: "The review screen shows a diff per sale: current value → Xero
 * value, grouped by field. The user can accept all, accept per sale, or
 * reject individual changes. Nothing writes until approved."
 *
 * So this file proposes and never applies. It is pure, which is what makes
 * the one rule that matters here testable rather than hoped for:
 *
 *   Xero owns  invoice number, invoice date, customer name, amount,
 *              currency, payment status, paid date
 *   we own     stock number, reference, brand, cost, sold-by, notes
 *
 * There is no branch anywhere below that writes one of ours. A field that
 * is not in `XERO_FIELDS` cannot be proposed, so the guarantee is
 * structural rather than a matter of remembering.
 */

/** Every field Xero is allowed to have an opinion about. Nothing else. */
export const XERO_FIELDS = [
  'invoiceNo', 'saleDate', 'customerName', 'saleAmount', 'saleCurrency',
  'paymentStatus', 'paidOn', 'dueOn',
] as const
export type XeroField = (typeof XERO_FIELDS)[number]

/**
 * Fields this system owns, named so the guarantee can be tested rather than
 * trusted. Alex: "Don't overwrite system-owned fields (cost, sold-by, stock
 * number, notes) from Xero."
 */
export const SYSTEM_FIELDS = [
  'stockNo', 'purchasePriceGbp', 'soldById', 'notes', 'channel', 'watchId',
] as const

export const FIELD_LABELS: Record<XeroField, string> = {
  invoiceNo: 'Invoice number',
  saleDate: 'Invoice date',
  customerName: 'Customer',
  saleAmount: 'Sale amount',
  saleCurrency: 'Currency',
  paymentStatus: 'Payment status',
  paidOn: 'Paid date',
  dueOn: 'Due date',
}

/** The sale as it stands, in only the fields Xero may speak to. */
export interface SaleSnapshot {
  id: string
  stockNo: number | null
  invoiceNo: string | null
  saleDate: Date
  customerName: string | null
  /** The amount as invoiced, in its own currency's minor units. */
  saleAmount: number | null
  saleCurrency: CurrencyCode
  paymentStatus: PaymentStatus
  paidOn: Date | null
  dueOn: Date | null
}

export interface ProposedChange {
  field: XeroField
  /** For the screen. */
  fromText: string
  toText: string
  /** For the writer. */
  to: string | number | Date | null
}

/**
 * The same calendar day, not the same instant.
 *
 * A sale booked through the form is stored at midnight UTC of the day
 * somebody picked, but older rows carry a time of day, and an invoice date
 * is always midnight. Comparing instants offers "2026-10-14 → 2026-10-14"
 * as a change — a row on the review screen that changes nothing visible,
 * which is how a reviewer learns to stop reading them.
 */
const sameDay = (a: Date | null, b: Date | null) =>
  a === null || b === null
    ? a === b
    : a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)

const dateText = (value: Date | null) =>
  value ? value.toISOString().slice(0, 10) : '—'

const moneyText = (minor: number | null, currency: CurrencyCode) =>
  minor === null ? '—' : `${currency} ${(minor / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`

/**
 * What this invoice says about this sale that the sale does not already say.
 *
 * `allocated` is this sale's share of the invoice in the invoice's own
 * currency — the whole invoice where it covers one watch, and its slice
 * where it covers several.
 *
 * A voided invoice proposes nothing. Alex: "Voided invoices unlink and flag
 * the sale" — that is an unlink and a flag, not a set of field edits, and
 * proposing edits from an invoice that no longer exists would be the
 * opposite of what he asked for.
 */
export function proposeChanges(
  sale: SaleSnapshot,
  invoice: XeroInvoice,
  allocated: number,
): ProposedChange[] {
  if (invoice.status === 'VOIDED' || invoice.status === 'DRAFT') return []

  const changes: ProposedChange[] = []

  // The invoice number. A placeholder on our side is exactly the case this
  // feature exists for, so it always loses to a real one.
  if (isPlaceholderInvoiceNo(sale.invoiceNo)
    || normaliseInvoiceNo(sale.invoiceNo ?? '') !== normaliseInvoiceNo(invoice.invoiceNo)) {
    changes.push({
      field: 'invoiceNo',
      fromText: sale.invoiceNo?.trim() || '—',
      toText: invoice.invoiceNo,
      to: invoice.invoiceNo,
    })
  }

  // The date. Compared by day, because both are stored as midnight UTC of
  // the day somebody meant and a time-of-day difference would be noise.
  if (invoice.invoiceDate && !sameDay(sale.saleDate, invoice.invoiceDate)) {
    changes.push({
      field: 'saleDate',
      fromText: dateText(sale.saleDate),
      toText: dateText(invoice.invoiceDate),
      to: invoice.invoiceDate,
    })
  }

  // The customer. Compared normalised so "A Dealer & Co" against "A Dealer
  // and Co" is not offered as a change nobody wants to click.
  if (invoice.contactName
    && normaliseName(sale.customerName ?? '') !== normaliseName(invoice.contactName)) {
    changes.push({
      field: 'customerName',
      fromText: sale.customerName?.trim() || '—',
      toText: invoice.contactName,
      to: invoice.contactName,
    })
  }

  // The money, in the currency it was invoiced in. Both have to move
  // together or the sale ends up quoting one currency's figure under
  // another's name.
  if (sale.saleCurrency !== invoice.currency) {
    changes.push({
      field: 'saleCurrency',
      fromText: sale.saleCurrency,
      toText: invoice.currency,
      to: invoice.currency,
    })
  }
  if (sale.saleAmount !== allocated) {
    changes.push({
      field: 'saleAmount',
      fromText: moneyText(sale.saleAmount, sale.saleCurrency),
      toText: moneyText(allocated, invoice.currency),
      to: allocated,
    })
  }

  // The payment status. Alex: "'Awaiting payment' must show on every unpaid
  // sale, not just some."
  const status = paymentStatusFor(invoice.status)
  if (status && status !== sale.paymentStatus) {
    changes.push({
      field: 'paymentStatus',
      fromText: sale.paymentStatus,
      toText: status,
      to: status,
    })
  }

  if (invoice.paidDate && !sameDay(sale.paidOn, invoice.paidDate)) {
    changes.push({
      field: 'paidOn',
      fromText: dateText(sale.paidOn),
      toText: dateText(invoice.paidDate),
      to: invoice.paidDate,
    })
  }

  // The due date, which is what "past due" is measured against.
  if (invoice.dueDate && !sameDay(sale.dueOn, invoice.dueDate)) {
    changes.push({
      field: 'dueOn',
      fromText: dateText(sale.dueOn),
      toText: dateText(invoice.dueDate),
      to: invoice.dueDate,
    })
  }

  return changes
}

/**
 * Everything that disagreed, for the exceptions report.
 *
 * Alex: "Exceptions report after each import: invoices in Xero with no
 * sale, sales with no invoice, amount mismatches, status mismatches, date
 * mismatches over 3 days. Exportable."
 *
 * A mismatch here is not the same as a proposed change. A change is
 * something to approve; an exception is something to look at, including the
 * ones there is no change for — an invoice with no sale behind it cannot be
 * fixed by editing a field.
 */
export type ExceptionKind =
  | 'INVOICE_WITHOUT_SALE'
  | 'SALE_WITHOUT_INVOICE'
  | 'AMOUNT_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'DATE_MISMATCH'
  | 'VOIDED'

export interface ReconcileException {
  kind: ExceptionKind
  invoiceNo: string | null
  saleId: string | null
  stockNo: number | null
  detail: string
}

export const EXCEPTION_LABELS: Record<ExceptionKind, string> = {
  INVOICE_WITHOUT_SALE: 'In Xero, no sale',
  SALE_WITHOUT_INVOICE: 'Sale, no Xero invoice',
  AMOUNT_MISMATCH: 'Amount differs',
  STATUS_MISMATCH: 'Status differs',
  DATE_MISMATCH: 'Date differs by more than 3 days',
  VOIDED: 'Voided in Xero',
}

/** Three days, the same tolerance the matcher allows. */
const DAY = 86_400_000
const DAY_TOLERANCE = 3

export function exceptionsFor(
  sale: SaleSnapshot,
  invoice: XeroInvoice,
  allocated: number,
): ReconcileException[] {
  const out: ReconcileException[] = []
  const at = { invoiceNo: invoice.invoiceNo, saleId: sale.id, stockNo: sale.stockNo }

  if (invoice.status === 'VOIDED') {
    out.push({ ...at, kind: 'VOIDED', detail: 'Unlink this sale and check it' })
    return out
  }

  if (sale.saleCurrency === invoice.currency && sale.saleAmount !== null
    && sale.saleAmount !== allocated) {
    out.push({
      ...at,
      kind: 'AMOUNT_MISMATCH',
      detail: `${moneyText(sale.saleAmount, sale.saleCurrency)} here, ${moneyText(allocated, invoice.currency)} in Xero`,
    })
  }

  const status = paymentStatusFor(invoice.status)
  if (status && status !== sale.paymentStatus) {
    out.push({ ...at, kind: 'STATUS_MISMATCH', detail: `${sale.paymentStatus} here, ${status} in Xero` })
  }

  if (invoice.invoiceDate) {
    const days = Math.abs(sale.saleDate.getTime() - invoice.invoiceDate.getTime()) / DAY
    if (days > DAY_TOLERANCE) {
      out.push({
        ...at,
        kind: 'DATE_MISMATCH',
        detail: `${dateText(sale.saleDate)} here, ${dateText(invoice.invoiceDate)} in Xero`,
      })
    }
  }
  return out
}
