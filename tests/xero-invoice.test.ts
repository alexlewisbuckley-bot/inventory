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

/**
 * The real shape of a Xero "Sales Invoices" export.
 *
 * Taken column-for-column from the file Alex sent — 44 columns, the
 * invoice number nineteenth, the currency fortieth, day-first dates, one
 * row per line — with the names and addresses replaced, because this repo
 * is public and his customers' details are not ours to publish.
 *
 * It exists because the parser is the one part of the reconcile that a
 * change to Xero's export could break silently: every column is found by
 * name, and a renamed heading would simply stop filling a field rather
 * than fail.
 */
const REAL_HEADER = [
  'ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3',
  'POAddressLine4', 'POCity', 'PORegion', 'POPostalCode', 'POCountry',
  'SAAddressLine1', 'SAAddressLine2', 'SAAddressLine3', 'SAAddressLine4', 'SACity',
  'SARegion', 'SAPostalCode', 'SACountry', 'InvoiceNumber', 'Reference',
  'InvoiceDate', 'DueDate', 'PlannedDate', 'Total', 'TaxTotal',
  'InvoiceAmountPaid', 'InvoiceAmountDue', 'InventoryItemCode', 'Description', 'Quantity',
  'UnitAmount', 'Discount', 'LineAmount', 'AccountCode', 'TaxType',
  'TaxAmount', 'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2',
  'Currency', 'Type', 'Sent', 'Status',
]

/** One row of that export, by column name. */
const realRow = (over: Record<string, string>) => {
  const row = new Array(REAL_HEADER.length).fill('')
  for (const [key, value] of Object.entries(over)) {
    const at = REAL_HEADER.indexOf(key)
    if (at < 0) throw new Error(`no such column: ${key}`)
    row[at] = value
  }
  return row
}

describe('a Xero Sales Invoices export, as Xero actually writes it', () => {
  const table = [
    REAL_HEADER,
    realRow({
      ContactName: 'A Dealer', InvoiceNumber: 'INV-0120', InvoiceDate: '28/10/2026',
      DueDate: '28/10/2026', Total: '5000.0000', Description: 'Commission RM67-01',
      Quantity: '1.0000', UnitAmount: '5000.0000', LineAmount: '5000.0000',
      Currency: 'USD', Type: 'Sales invoice', Sent: 'Unsent', Status: 'Paid',
    }),
    realRow({
      ContactName: 'A Borrower', InvoiceNumber: 'INV-0115', InvoiceDate: '23/10/2026',
      DueDate: '30/10/2026', Total: '6600.0000', Description: 'Extension Fees Stock 8 & 9',
      Quantity: '1.0000', LineAmount: '6600.0000',
      Currency: 'AED', Type: 'Sales invoice', Sent: 'Sent', Status: 'Awaiting Payment',
    }),
    // One invoice over two rows, as a two-watch invoice arrives.
    realRow({
      ContactName: 'A Dealer', InvoiceNumber: 'INV-0113', InvoiceDate: '22/10/2026',
      Total: '41661.0000', InventoryItemCode: '45', Description: 'Rolex Stock 45',
      LineAmount: '20830.5000', Currency: 'USD', Status: 'Paid',
    }),
    realRow({
      ContactName: 'A Dealer', InvoiceNumber: 'INV-0113', InvoiceDate: '22/10/2026',
      Total: '41661.0000', InventoryItemCode: '46', Description: 'Rolex Stock 46',
      LineAmount: '20830.5000', Currency: 'USD', Status: 'Paid',
    }),
    // One carrying tax, where the total and the line amount differ.
    realRow({
      ContactName: 'A Broker', InvoiceNumber: 'INV-0109', InvoiceDate: '19/10/2026',
      Total: '5250.0000', TaxTotal: '250.0000', Description: 'Patek 5167R sale commission',
      UnitAmount: '5000.0000', LineAmount: '5000.0000', TaxAmount: '250.0000',
      Currency: 'USD', Status: 'Paid',
    }),
  ]

  it('finds every column in the real 44-column layout', () => {
    const at = readHeader(REAL_HEADER)
    expect(at['invoiceNo']).toBe(18)
    expect(at['contactName']).toBe(0)
    expect(at['invoiceDate']).toBe(20)
    expect(at['dueDate']).toBe(21)
    expect(at['total']).toBe(23)
    expect(at['description']).toBe(28)
    expect(at['lineAmount']).toBe(32)
    expect(at['currency']).toBe(40)
    expect(at['status']).toBe(43)
  })

  it('does not mistake one of the many amount columns for the total', () => {
    // TaxTotal, InvoiceAmountPaid, InvoiceAmountDue, UnitAmount, Discount
    // and TaxAmount all sit beside it.
    const at = readHeader(REAL_HEADER)
    expect(at['total']).not.toBe(REAL_HEADER.indexOf('TaxTotal'))
    expect(at['total']).not.toBe(REAL_HEADER.indexOf('InvoiceAmountPaid'))
    expect(at['lineAmount']).not.toBe(REAL_HEADER.indexOf('UnitAmount'))
  })

  it('reads every invoice out of it', () => {
    const { invoices, skipped } = parseXeroExport(table, { base: 'AED' })
    expect(skipped).toBe(0)
    expect(invoices.map((i) => i.invoiceNo)).toEqual(['INV-0120', 'INV-0115', 'INV-0113', 'INV-0109'])
  })

  it('reads day-first dates the way Xero writes them here', () => {
    const { invoices } = parseXeroExport(table, { base: 'AED' })
    // 28/10 is the 28th of October, never the 10th of a 28th month.
    expect(invoices[0]!.invoiceDate?.toISOString().slice(0, 10)).toBe('2026-10-28')
    expect(invoices[1]!.invoiceDate?.toISOString().slice(0, 10)).toBe('2026-10-23')
  })

  it('keeps each invoice in its own currency', () => {
    const { invoices } = parseXeroExport(table, { base: 'AED' })
    expect(invoices.map((i) => i.currency)).toEqual(['USD', 'AED', 'USD', 'USD'])
  })

  it('takes the stated total on a two-line invoice, not twice a line', () => {
    const { invoices } = parseXeroExport(table, { base: 'AED' })
    const two = invoices.find((i) => i.invoiceNo === 'INV-0113')!
    expect(two.lines).toHaveLength(2)
    expect(two.total).toBe(4_166_100)
  })

  it('takes the total including tax, not the line amount under it', () => {
    // The commission with 250 of tax: the customer was asked for 5,250.
    const { invoices } = parseXeroExport(table, { base: 'AED' })
    expect(invoices.find((i) => i.invoiceNo === 'INV-0109')!.total).toBe(525_000)
  })

  it('reads "Awaiting Payment" as unpaid', () => {
    const { invoices } = parseXeroExport(table, { base: 'AED' })
    expect(invoices.find((i) => i.invoiceNo === 'INV-0115')!.status).toBe('AWAITING_PAYMENT')
  })

  it('finds a stock number in the description, where Xero puts it', () => {
    const { invoices } = parseXeroExport(table, { base: 'AED' })
    expect(searchableText(invoices.find((i) => i.invoiceNo === 'INV-0113')!)).toContain('Stock 45')
  })
})
