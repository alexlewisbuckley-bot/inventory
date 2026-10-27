import { CURRENCIES, type CurrencyCode } from './enums'
import {
  readCurrency, readDate, readMoney, readStatus, type XeroInvoice, type XeroLine,
} from './xero-invoice'

/**
 * Turning what Claude saw in a screenshot into invoices.
 *
 * Alex: "I want to be able to drop screenshots of xero into the reconcile
 * feature."
 *
 * A picture of a Xero screen is a third way in, beside a CSV and — later —
 * the API. All three have to arrive at the same place: `XeroInvoice[]`,
 * which the matcher, the allocator and the diff already speak. Nothing
 * downstream learns that a screenshot exists.
 *
 * This file is the part worth testing: the model's answer coerced into that
 * shape. Kept apart from the call itself so it can be exercised against the
 * answers a model actually gives — half-filled fields, a date written three
 * ways, a total with a currency symbol in it, a status in whatever case the
 * screen happened to show — without an API key.
 *
 * Every field goes through the same readers the CSV path uses, so a date or
 * an amount means exactly what it means from a file. A screenshot must not
 * be a second set of parsing rules.
 */

/** One invoice as the model is asked to report it: all strings, no nulls. */
export interface SeenInvoice {
  invoice_no: string
  contact_name: string
  invoice_date: string
  due_date: string
  paid_date: string
  currency: string
  total: string
  status: string
  reference: string
  lines: Array<{ description: string; amount: string }>
}

/**
 * Strings everywhere, and "" for "the screen does not say".
 *
 * A model asked for `number | null` returns 0 for a figure it could not
 * read about as often as it returns null, and a 0 total is a reconciliation
 * that silently writes a watch off. A string either parses or it does not,
 * and "" is unambiguous.
 */
export const XERO_VISION_SCHEMA = {
  type: 'object' as const,
  properties: {
    invoices: {
      type: 'array' as const,
      description: 'Every invoice visible in the screenshots, in the order they appear.',
      items: {
        type: 'object' as const,
        properties: {
          invoice_no: { type: 'string' as const, description: 'The invoice number exactly as shown, e.g. "INV-0241". "" if not visible.' },
          contact_name: { type: 'string' as const, description: 'The customer or contact name exactly as shown. "" if not visible.' },
          invoice_date: { type: 'string' as const, description: 'The invoice date as shown, e.g. "14 Oct 2026" or "14/10/2026". "" if not visible.' },
          due_date: { type: 'string' as const, description: 'The due date as shown. "" if not visible.' },
          paid_date: { type: 'string' as const, description: 'The date it was paid, if the screen shows one. "" otherwise.' },
          currency: { type: 'string' as const, description: 'Three-letter code: AED, USD, GBP or HKD. "" if not visible.' },
          total: { type: 'string' as const, description: 'The invoice total exactly as shown, including decimals, e.g. "297,000.01". "" if not visible.' },
          status: { type: 'string' as const, description: 'Paid, Awaiting Payment, Overdue, Voided or Draft, as shown.' },
          reference: { type: 'string' as const, description: 'The reference field, which often carries a stock number. "" if not visible.' },
          lines: {
            type: 'array' as const,
            description: 'The line items, where the screen shows them. Empty where it only shows a list of invoices.',
            items: {
              type: 'object' as const,
              properties: {
                description: { type: 'string' as const },
                amount: { type: 'string' as const, description: 'The line amount as shown. "" if not visible.' },
              },
              required: ['description', 'amount'],
            },
          },
        },
        required: [
          'invoice_no', 'contact_name', 'invoice_date', 'due_date', 'paid_date',
          'currency', 'total', 'status', 'reference', 'lines',
        ],
      },
    },
  },
  required: ['invoices'],
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * What the model returned, as invoices.
 *
 * Deliberately forgiving about shape and strict about meaning. A missing
 * array, a line that is not an object, a number where a string was asked
 * for — all survivable, because the alternative is one malformed row
 * discarding a screenshot somebody has just waited ten seconds for. A
 * total that does not parse is not survivable in the same way, so the
 * invoice carrying it is dropped and counted rather than imported as zero.
 */
export function coerceXeroInvoices(
  input: unknown,
  base: CurrencyCode = 'AED',
): { invoices: XeroInvoice[]; dropped: number } {
  const raw = (input as { invoices?: unknown })?.invoices
  if (!Array.isArray(raw)) return { invoices: [], dropped: 0 }

  const invoices: XeroInvoice[] = []
  let dropped = 0

  for (const row of raw) {
    if (!row || typeof row !== 'object') { dropped += 1; continue }
    const seen = row as Record<string, unknown>

    const invoiceNo = text(seen['invoice_no'] ?? seen['invoiceNo'])
    // An invoice with no number is not something to match on, and inventing
    // one would put a row on the review screen nobody can trace back to the
    // screen it came from.
    if (!invoiceNo) { dropped += 1; continue }

    const total = readMoney(text(seen['total']))
    if (total === null) { dropped += 1; continue }

    const lines: XeroLine[] = Array.isArray(seen['lines'])
      ? (seen['lines'] as unknown[]).flatMap((line) => {
        if (!line || typeof line !== 'object') return []
        const item = line as Record<string, unknown>
        const description = text(item['description'])
        const amount = readMoney(text(item['amount']))
        if (!description && amount === null) return []
        return [{ description, amount, quantity: null }]
      })
      : []

    invoices.push({
      invoiceNo,
      contactName: text(seen['contact_name'] ?? seen['contactName']),
      invoiceDate: readDate(text(seen['invoice_date'] ?? seen['invoiceDate'])),
      dueDate: readDate(text(seen['due_date'] ?? seen['dueDate'])),
      paidDate: readDate(text(seen['paid_date'] ?? seen['paidDate'])),
      currency: readCurrency(text(seen['currency']), base),
      total,
      status: readStatus(text(seen['status'])),
      reference: text(seen['reference']),
      lines,
      // A screenshot has no rows to point at. The exceptions report says
      // which invoice rather than which line of a file, which is the only
      // honest answer for a picture.
      rows: [],
    })
  }

  return { invoices, dropped }
}

/** The currencies the prompt may name, kept in step with the enum. */
export const VISION_CURRENCIES = CURRENCIES.join(', ')
