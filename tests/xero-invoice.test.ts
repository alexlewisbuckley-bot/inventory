import { describe, expect, it } from 'vitest'
import {
  parseXeroExport, readDate, readMoney, readStatus, readHeader, readCurrency,
  paymentStatusFor, searchableText,
} from '@/lib/xero-invoice'

/** A Xero UI export, which is one row per line item. */
const EXPORT = [
  ['Invoice Number', 'Contact Name', 'Invoice Date', 'Due Date', 'Currency', 'Reference', 'Description', 'Quantity', 'Line Amount', 'Total', 'Status'],
  ['INV-0241', 'Sweepings Hands', '2026-10-14', '2026-10-28', 'AED', 'Stock 1366', 'Rolex Daytona 116500LN', '1', '148500.00', '297000.00', 'Awaiting Payment'],
  ['INV-0241', '', '', '', '', '', 'Rolex Submariner 126610LV', '1', '148500.00', '', ''],
  ['INV-0242', 'Trendsourcing Dubai', '2026-10-15', '2026-10-29', 'USD', '', 'Patek Philippe 5711', '1', '92000.00', '92000.00', 'PAID'],
]

describe('reading a Xero export', () => {
  it('finds its columns by name, not by position', () => {
    const at = readHeader(EXPORT[0]!)
    expect(at['invoiceNo']).toBe(0)
    expect(at['contactName']).toBe(1)
    expect(at['status']).toBe(10)
  })

  it('does not let a loose heading steal a column a specific one wants', () => {
    // "Amount" is listed under both `total` and `lineAmount`. "Line Amount"
    // is the more specific heading and must win its own column.
    const at = readHeader(['Invoice Number', 'Line Amount', 'Amount'])
    expect(at['lineAmount']).toBe(1)
    expect(at['total']).toBe(2)
  })

  it('reads an invoice spread over two lines as one invoice', () => {
    const { invoices } = parseXeroExport(EXPORT)
    expect(invoices).toHaveLength(2)
    const first = invoices[0]!
    expect(first.invoiceNo).toBe('INV-0241')
    expect(first.lines).toHaveLength(2)
    // Xero leaves the header fields blank on a continuation row. A blank
    // must not wipe what the first row said.
    expect(first.contactName).toBe('Sweepings Hands')
    expect(first.reference).toBe('Stock 1366')
    expect(first.invoiceDate?.toISOString()).toBe('2026-10-14T00:00:00.000Z')
  })

  it('takes the total Xero states, not a sum of the lines', () => {
    // The stated total is what the customer was asked for; a sum of lines
    // can miss rounding, a discount or tax.
    const { invoices } = parseXeroExport(EXPORT)
    expect(invoices[0]!.total).toBe(29_700_000)
  })

  it('falls back to summing the lines when no total is given', () => {
    const { invoices } = parseXeroExport([
      ['Invoice Number', 'Contact Name', 'Invoice Date', 'Line Amount', 'Status'],
      ['INV-1', 'A Dealer', '2026-10-14', '1000.00', 'PAID'],
      ['INV-1', '', '', '250.50', ''],
    ])
    expect(invoices[0]!.total).toBe(125_050)
  })

  it('keeps each invoice’s own currency', () => {
    const { invoices } = parseXeroExport(EXPORT)
    expect(invoices.map((i) => i.currency)).toEqual(['AED', 'USD'])
  })

  it('counts the rows it could not place rather than dropping them', () => {
    const { invoices, skipped } = parseXeroExport([
      ...EXPORT,
      ['', '', '', '', '', '', 'Total', '', '', '389000.00', ''],
    ])
    expect(invoices).toHaveLength(2)
    expect(skipped).toBe(1)
  })

  it('finds the header even when the export has a title above it', () => {
    const { invoices } = parseXeroExport([
      ['One Street Watches FZCO'],
      ['Sales Invoices'],
      [],
      ...EXPORT,
    ])
    expect(invoices).toHaveLength(2)
  })

  it('reports which rows an invoice came from', () => {
    const { invoices } = parseXeroExport(EXPORT)
    expect(invoices[0]!.rows).toEqual([2, 3])
  })
})

describe('the statuses', () => {
  it('treats every unpaid wording as unpaid', () => {
    // Alex: "Awaiting payment must show on every unpaid sale, not just
    // some." Xero writes this three ways depending on the export.
    expect(readStatus('Awaiting Payment')).toBe('AWAITING_PAYMENT')
    expect(readStatus('AWAITING_PAYMENT')).toBe('AWAITING_PAYMENT')
    expect(readStatus('AUTHORISED')).toBe('AWAITING_PAYMENT')
    expect(paymentStatusFor('AWAITING_PAYMENT')).toBe('PENDING')
  })

  it('maps the rest onto ours', () => {
    expect(paymentStatusFor(readStatus('PAID'))).toBe('PAID')
    expect(paymentStatusFor(readStatus('Overdue'))).toBe('OVERDUE')
  })

  it('gives a voided or draft invoice no payment status at all', () => {
    // A voided invoice unlinks and flags the sale; a draft is not yet a
    // promise to pay. Neither has a payment status to copy over.
    expect(paymentStatusFor(readStatus('VOIDED'))).toBeNull()
    expect(paymentStatusFor(readStatus('DRAFT'))).toBeNull()
  })

  it('never reads an unknown status as paid', () => {
    // The one direction that costs money if it is wrong.
    expect(readStatus('Something New')).toBe('DRAFT')
    expect(paymentStatusFor(readStatus('Something New'))).not.toBe('PAID')
  })
})

describe('the cells', () => {
  it('reads money to the minor unit', () => {
    expect(readMoney('1,015,424.50')).toBe(101_542_450)
    expect(readMoney('AED 76,550')).toBe(7_655_000)
    expect(readMoney('(250.00)')).toBe(-25_000)
    expect(readMoney('')).toBeNull()
    expect(readMoney('n/a')).toBeNull()
  })

  it('does not lose a cent to floating point', () => {
    expect(readMoney('0.07')).toBe(7)
    expect(readMoney('1234.35')).toBe(123_435)
  })

  it('reads ISO and day-first dates', () => {
    expect(readDate('2026-10-14')?.toISOString()).toBe('2026-10-14T00:00:00.000Z')
    expect(readDate('14/10/2026')?.toISOString()).toBe('2026-10-14T00:00:00.000Z')
    expect(readDate('14 Oct 2026')?.toISOString()).toBe('2026-10-14T00:00:00.000Z')
    expect(readDate('')).toBeNull()
  })

  it('reads a date as the day it names, not as the server’s day', () => {
    // Sale dates are stored as midnight UTC of the chosen day, so an
    // invoice date has to land on exactly the same instant to compare.
    expect(readDate('27/10/2026')?.toISOString()).toBe('2026-10-27T00:00:00.000Z')
  })

  it('falls back to the organisation’s base currency', () => {
    expect(readCurrency('', 'AED')).toBe('AED')
    expect(readCurrency('gbp', 'AED')).toBe('GBP')
    expect(readCurrency('EUR', 'AED')).toBe('AED')
  })
})

describe('where a stock number might be hiding', () => {
  it('searches the reference and every line description as one', () => {
    const { invoices } = parseXeroExport(EXPORT)
    const text = searchableText(invoices[0]!)
    expect(text).toContain('Stock 1366')
    expect(text).toContain('116500LN')
    expect(text).toContain('126610LV')
  })
})

describe('when the money arrived', () => {
  it('reads the paid date, whatever Xero called the column', () => {
    // Alex: "Record paid date from Xero." The column is named three ways
    // depending on which export you take.
    for (const heading of ['Fully Paid Date', 'Paid Date', 'Date Paid']) {
      const { invoices } = parseXeroExport([
        ['Invoice Number', 'Contact Name', 'Invoice Date', heading, 'Total', 'Status'],
        ['INV-1', 'A Dealer', '2026-10-14', '2026-10-20', '1000.00', 'PAID'],
      ])
      expect(invoices[0]!.paidDate?.toISOString()).toBe('2026-10-20T00:00:00.000Z')
    }
  })

  it('leaves it null on an unpaid invoice', () => {
    const { invoices } = parseXeroExport(EXPORT)
    expect(invoices[0]!.paidDate).toBeNull()
  })
})
