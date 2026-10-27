import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  proposeChanges, exceptionsFor, XERO_FIELDS, SYSTEM_FIELDS, FIELD_LABELS,
  type SaleSnapshot,
} from '@/lib/xero-diff'
import type { XeroInvoice } from '@/lib/xero-invoice'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const invoice = (over: Partial<XeroInvoice> = {}): XeroInvoice => ({
  invoiceNo: 'INV-0241',
  contactName: 'Sweepings Hands',
  invoiceDate: day('2026-10-14'),
  dueDate: day('2026-10-28'),
  paidDate: null,
  currency: 'AED',
  total: 10_000_000,
  status: 'AWAITING_PAYMENT',
  reference: '',
  lines: [],
  rows: [2],
  ...over,
})

const sale = (over: Partial<SaleSnapshot> = {}): SaleSnapshot => ({
  id: 's1',
  stockNo: 1366,
  invoiceNo: 'INV-0241',
  saleDate: day('2026-10-14'),
  customerName: 'Sweepings Hands',
  saleAmount: 10_000_000,
  saleCurrency: 'AED',
  paymentStatus: 'PENDING',
  paidOn: null,
  ...over,
})

const fields = (changes: Array<{ field: string }>) => changes.map((c) => c.field)

describe('what Xero is allowed to change', () => {
  it('proposes nothing when the two already agree', () => {
    expect(proposeChanges(sale(), invoice(), 10_000_000)).toEqual([])
  })

  it('fills in a TBA invoice number', () => {
    // The case the whole feature exists for.
    const changes = proposeChanges(sale({ invoiceNo: 'TBA-01' }), invoice(), 10_000_000)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ field: 'invoiceNo', fromText: 'TBA-01', toText: 'INV-0241' })
  })

  it('corrects the date, the customer and the status', () => {
    const changes = proposeChanges(
      sale({
        saleDate: day('2026-10-11'),
        customerName: 'Henry Fisher',
        paymentStatus: 'PAID',
      }),
      invoice(),
      10_000_000,
    )
    expect(fields(changes)).toEqual(['saleDate', 'customerName', 'paymentStatus'])
    expect(changes.find((c) => c.field === 'paymentStatus')?.toText).toBe('PENDING')
  })

  it('does not offer a customer change that is only punctuation', () => {
    // "A Dealer & Co" and "A Dealer and Co" are one customer. Offering
    // that as a change is a click nobody wants.
    const changes = proposeChanges(
      sale({ customerName: 'A. Dealer & Co' }),
      invoice({ contactName: 'A Dealer and Co' }),
      10_000_000,
    )
    expect(fields(changes)).not.toContain('customerName')
  })

  it('moves the amount and the currency together', () => {
    const changes = proposeChanges(
      sale({ saleCurrency: 'AED', saleAmount: 10_000_000 }),
      invoice({ currency: 'USD', total: 2_700_000 }),
      2_700_000,
    )
    expect(fields(changes)).toEqual(['saleCurrency', 'saleAmount'])
    expect(changes.find((c) => c.field === 'saleAmount')?.toText).toBe('USD 27,000.00')
  })

  it('proposes this sale’s share, not the whole invoice', () => {
    // A two-watch invoice: each sale is offered its own slice.
    const changes = proposeChanges(sale({ saleAmount: 10_000_000 }), invoice({ total: 29_700_000 }), 14_850_000)
    expect(changes.find((c) => c.field === 'saleAmount')?.to).toBe(14_850_000)
  })

  it('records the paid date when Xero has one', () => {
    const changes = proposeChanges(
      sale({ paymentStatus: 'PAID' }),
      invoice({ status: 'PAID', paidDate: day('2026-10-20') }),
      10_000_000,
    )
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ field: 'paidOn', toText: '2026-10-20' })
  })

  it('proposes nothing at all from a voided or draft invoice', () => {
    // Alex: "Voided invoices unlink and flag the sale." That is an unlink
    // and a flag, not a set of field edits from an invoice that no longer
    // exists.
    expect(proposeChanges(sale({ invoiceNo: 'TBA-01' }), invoice({ status: 'VOIDED' }), 1)).toEqual([])
    expect(proposeChanges(sale({ invoiceNo: 'TBA-01' }), invoice({ status: 'DRAFT' }), 1)).toEqual([])
  })
})

describe('what Xero is never allowed to change', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/xero-diff.ts'), 'utf8')

  it('names only the seven fields Xero owns', () => {
    expect([...XERO_FIELDS]).toEqual([
      'invoiceNo', 'saleDate', 'customerName', 'saleAmount', 'saleCurrency',
      'paymentStatus', 'paidOn',
    ])
  })

  it('cannot propose a system-owned field', () => {
    // Alex: "Don't overwrite system-owned fields (cost, sold-by, stock
    // number, notes) from Xero." Structural rather than remembered: a
    // field that is not a XeroField has nowhere to be proposed.
    for (const owned of SYSTEM_FIELDS) {
      expect(XERO_FIELDS as readonly string[]).not.toContain(owned)
    }
  })

  it('never proposes one across a wide sweep of differences', () => {
    // Every field moved at once; the proposal still only touches Xero's.
    const changes = proposeChanges(
      sale({
        invoiceNo: 'TBA-01', saleDate: day('2026-01-01'), customerName: 'Someone',
        saleAmount: 1, saleCurrency: 'GBP', paymentStatus: 'PAID', paidOn: day('2026-01-01'),
        stockNo: 9999,
      }),
      invoice({ paidDate: day('2026-10-20') }),
      10_000_000,
    )
    for (const field of fields(changes)) {
      expect(XERO_FIELDS as readonly string[]).toContain(field)
    }
    expect(fields(changes)).not.toContain('stockNo')
  })

  it('has a label for every field it can propose', () => {
    for (const field of XERO_FIELDS) expect(FIELD_LABELS[field]).toBeTruthy()
  })

  it('writes no system-owned field anywhere in the module', () => {
    // A guard against the next person adding a branch for one.
    expect(source).not.toMatch(/field: 'notes'|field: 'soldById'|field: 'stockNo'|field: 'channel'/)
  })
})

describe('the exceptions report', () => {
  it('flags an amount that does not agree', () => {
    const out = exceptionsFor(sale({ saleAmount: 9_000_000 }), invoice(), 10_000_000)
    expect(out.map((e) => e.kind)).toContain('AMOUNT_MISMATCH')
    expect(out[0]?.detail).toBe('AED 90,000.00 here, AED 100,000.00 in Xero')
  })

  it('flags a status that does not agree', () => {
    const out = exceptionsFor(sale({ paymentStatus: 'PAID' }), invoice(), 10_000_000)
    expect(out.map((e) => e.kind)).toEqual(['STATUS_MISMATCH'])
  })

  it('flags a date more than three days out, and not one inside it', () => {
    expect(exceptionsFor(sale({ saleDate: day('2026-10-17') }), invoice(), 10_000_000)
      .map((e) => e.kind)).not.toContain('DATE_MISMATCH')
    expect(exceptionsFor(sale({ saleDate: day('2026-10-18') }), invoice(), 10_000_000)
      .map((e) => e.kind)).toContain('DATE_MISMATCH')
  })

  it('says only "voided" for a voided invoice', () => {
    // Everything else about it is moot.
    const out = exceptionsFor(sale({ saleAmount: 1, paymentStatus: 'PAID' }), invoice({ status: 'VOIDED' }), 10_000_000)
    expect(out.map((e) => e.kind)).toEqual(['VOIDED'])
  })

  it('carries the stock number so a reader can find the watch', () => {
    const out = exceptionsFor(sale({ saleAmount: 9_000_000 }), invoice(), 10_000_000)
    expect(out[0]?.stockNo).toBe(1366)
  })
})

describe('a change that changes nothing is not a change', () => {
  it('does not offer a date move when only the time of day differs', () => {
    // Older sales carry a time; an invoice date is always midnight.
    // "2026-10-14 → 2026-10-14" is a row on the review screen that does
    // nothing, which is how a reviewer learns to stop reading them.
    const changes = proposeChanges(
      sale({ saleDate: new Date('2026-10-14T09:30:00.000Z') }),
      invoice({ invoiceDate: day('2026-10-14') }),
      10_000_000,
    )
    expect(fields(changes)).not.toContain('saleDate')
  })

  it('still offers a real date move', () => {
    const changes = proposeChanges(
      sale({ saleDate: new Date('2026-10-13T23:00:00.000Z') }),
      invoice({ invoiceDate: day('2026-10-14') }),
      10_000_000,
    )
    expect(fields(changes)).toContain('saleDate')
  })

  it('does not offer a paid date move when only the time differs', () => {
    const changes = proposeChanges(
      sale({ paymentStatus: 'PAID', paidOn: new Date('2026-10-20T14:00:00.000Z') }),
      invoice({ status: 'PAID', paidDate: day('2026-10-20') }),
      10_000_000,
    )
    expect(changes).toEqual([])
  })
})
