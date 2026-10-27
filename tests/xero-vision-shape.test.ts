import { describe, expect, it } from 'vitest'
import { coerceXeroInvoices, XERO_VISION_SCHEMA } from '@/lib/xero-vision-shape'

const seen = (over: Record<string, unknown> = {}) => ({
  invoice_no: 'INV-0241',
  contact_name: 'Sweepings Hands',
  invoice_date: '14 Oct 2026',
  due_date: '28 Oct 2026',
  paid_date: '',
  currency: 'AED',
  total: '297,000.01',
  status: 'Awaiting Payment',
  reference: 'Stock 1366',
  lines: [],
  ...over,
})

const read = (invoices: unknown[]) => coerceXeroInvoices({ invoices })

/**
 * Alex: "I want to be able to drop screenshots of xero into the reconcile
 * feature."
 *
 * A picture is the second way in, beside the export — and the whole point
 * of the matching layer taking `XeroInvoice[]` is that nothing downstream
 * learns which one it was. So a screenshot must parse its dates, its money
 * and its statuses through exactly the same readers a file does, and this
 * is where that is proved.
 */
describe('reading what Claude saw', () => {
  it('turns a seen invoice into the same shape a file produces', () => {
    const { invoices } = read([seen()])
    expect(invoices).toHaveLength(1)
    expect(invoices[0]).toMatchObject({
      invoiceNo: 'INV-0241',
      contactName: 'Sweepings Hands',
      currency: 'AED',
      total: 29_700_001,
      status: 'AWAITING_PAYMENT',
      reference: 'Stock 1366',
    })
    expect(invoices[0]!.invoiceDate?.toISOString()).toBe('2026-10-14T00:00:00.000Z')
    expect(invoices[0]!.dueDate?.toISOString()).toBe('2026-10-28T00:00:00.000Z')
  })

  it('reads money the same way the file path does, to the cent', () => {
    expect(read([seen({ total: '297,000.01' })]).invoices[0]!.total).toBe(29_700_001)
    expect(read([seen({ total: 'AED 76,550' })]).invoices[0]!.total).toBe(7_655_000)
    expect(read([seen({ total: '0.07' })]).invoices[0]!.total).toBe(7)
  })

  it('reads a date however the screen wrote it', () => {
    for (const written of ['2026-10-14', '14/10/2026', '14 Oct 2026', '14 October 2026']) {
      expect(read([seen({ invoice_date: written })]).invoices[0]!.invoiceDate?.toISOString())
        .toBe('2026-10-14T00:00:00.000Z')
    }
  })

  it('never reads an unknown status as paid', () => {
    // The one direction that costs money if it is wrong.
    expect(read([seen({ status: 'Something New' })]).invoices[0]!.status).toBe('DRAFT')
    expect(read([seen({ status: 'AUTHORISED' })]).invoices[0]!.status).toBe('AWAITING_PAYMENT')
  })

  it('carries the line items when the screen showed them', () => {
    const { invoices } = read([seen({
      lines: [
        { description: 'Rolex Daytona 116500LN', amount: '148,500.00' },
        { description: 'Rolex Submariner', amount: '148,500.01' },
      ],
    })])
    expect(invoices[0]!.lines).toEqual([
      { description: 'Rolex Daytona 116500LN', amount: 14_850_000, quantity: null },
      { description: 'Rolex Submariner', amount: 14_850_001, quantity: null },
    ])
  })

  it('accepts a list view that has no line items at all', () => {
    // The commonest screenshot: one row per invoice and no detail.
    expect(read([seen({ lines: [] })]).invoices[0]!.lines).toEqual([])
  })

  it('reports no source rows, because a picture has none', () => {
    expect(read([seen()]).invoices[0]!.rows).toEqual([])
  })
})

describe('what it refuses to invent', () => {
  it('drops an invoice with no number rather than making one up', () => {
    const { invoices, dropped } = read([seen({ invoice_no: '' }), seen()])
    expect(invoices).toHaveLength(1)
    expect(dropped).toBe(1)
  })

  it('drops an invoice whose total could not be made out', () => {
    // The alternative is importing it as zero, which is a reconciliation
    // that quietly writes a watch off.
    const { invoices, dropped } = read([seen({ total: '' }), seen({ total: '???' })])
    expect(invoices).toEqual([])
    expect(dropped).toBe(2)
  })

  it('leaves a date it could not read as null rather than guessing today', () => {
    const { invoices } = read([seen({ invoice_date: 'sometime last week' })])
    expect(invoices[0]!.invoiceDate).toBeNull()
  })

  it('falls back to the base currency rather than inventing one', () => {
    expect(read([seen({ currency: '' })]).invoices[0]!.currency).toBe('AED')
    expect(read([seen({ currency: 'EUR' })]).invoices[0]!.currency).toBe('AED')
  })
})

describe('when the answer comes back misshapen', () => {
  it('survives a missing array', () => {
    expect(coerceXeroInvoices({})).toEqual({ invoices: [], dropped: 0 })
    expect(coerceXeroInvoices(null)).toEqual({ invoices: [], dropped: 0 })
    expect(coerceXeroInvoices({ invoices: 'nope' })).toEqual({ invoices: [], dropped: 0 })
  })

  it('survives a row that is not an object', () => {
    const { invoices, dropped } = read(['nonsense', null, seen()])
    expect(invoices).toHaveLength(1)
    expect(dropped).toBe(2)
  })

  it('survives lines that are not lines', () => {
    const { invoices } = read([seen({ lines: ['x', null, { description: 'Real', amount: '10.00' }] })])
    expect(invoices[0]!.lines).toEqual([{ description: 'Real', amount: 1_000, quantity: null }])
  })

  it('survives lines arriving as something other than an array', () => {
    expect(read([seen({ lines: 'none' })]).invoices[0]!.lines).toEqual([])
  })

  it('accepts camelCase as well, since a model will sometimes use it', () => {
    const { invoices } = read([{
      invoiceNo: 'INV-1', contactName: 'A Dealer', invoiceDate: '2026-10-14',
      total: '100.00', status: 'PAID', lines: [],
    }])
    expect(invoices[0]).toMatchObject({ invoiceNo: 'INV-1', contactName: 'A Dealer', total: 10_000 })
  })

  it('does not trip over a number where a string was asked for', () => {
    // Strings are asked for precisely so this is rare, but it must not
    // throw when it happens.
    const { invoices, dropped } = read([seen({ total: 297000.01 as unknown as string })])
    expect(invoices).toEqual([])
    expect(dropped).toBe(1)
  })
})

describe('the shape asked of the model', () => {
  it('asks for strings throughout, so "" can mean "not shown"', () => {
    const item = (XERO_VISION_SCHEMA.properties.invoices.items as {
      properties: Record<string, { type: string }>
      required: string[]
    })
    for (const field of ['invoice_no', 'contact_name', 'invoice_date', 'total', 'status']) {
      expect(item.properties[field]!.type).toBe('string')
    }
    // Required everywhere, so a field the screen does not show arrives as
    // "" rather than as an absent key the coercion has to guess about.
    expect(item.required).toContain('total')
    expect(item.required).toContain('invoice_no')
  })
})
