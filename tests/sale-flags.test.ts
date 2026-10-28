import { describe, expect, it } from 'vitest'
import { flagsFor, flagTone, FLAG_LABELS, type FlaggableSale } from '@/lib/sale-flags'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const NOW = day('2026-10-27')

const sale = (over: Partial<FlaggableSale> = {}): FlaggableSale => ({
  invoiceNo: 'INV-0241',
  saleDate: day('2026-10-26'),
  customerName: 'Sweepings Hands',
  stockNo: 1366,
  costGbp: 9_400_000,
  channel: 'RETAIL',
  paymentStatus: 'PAID',
  dueOn: null,
  xeroSeenImportId: null,
  ...over,
})

const kinds = (s: FlaggableSale, opts = {}) =>
  flagsFor(s, { now: NOW, ...opts }).map((f) => f.kind)

/**
 * Alex: "Data-quality flags on the main sales table, always on, not just
 * at import."
 */
describe('what is wrong with a sale', () => {
  it('says nothing about a sale with nothing wrong', () => {
    expect(kinds(sale())).toEqual([])
  })

  it('leaves this morning’s TBA alone', () => {
    // "TBA" on today's sale is how the business works.
    expect(kinds(sale({ invoiceNo: 'TBA-01', saleDate: day('2026-10-26') })))
      .not.toContain('INVOICE_TBA')
  })

  it('chases a TBA more than two days old', () => {
    const flags = flagsFor(sale({ invoiceNo: 'TBA-01', saleDate: day('2026-10-24') }), { now: NOW })
    expect(flags.map((f) => f.kind)).toContain('INVOICE_TBA')
    expect(flags[0]!.detail).toBe('3 days since the sale and still TBA-01')
  })

  it('treats a blank invoice number the same as a TBA', () => {
    expect(kinds(sale({ invoiceNo: '', saleDate: day('2026-10-20') }))).toContain('INVOICE_TBA')
    expect(kinds(sale({ invoiceNo: null, saleDate: day('2026-10-20') }))).toContain('INVOICE_TBA')
  })

  it('flags a blank customer', () => {
    expect(kinds(sale({ customerName: null }))).toContain('NO_CUSTOMER')
    expect(kinds(sale({ customerName: '   ' }))).toContain('NO_CUSTOMER')
  })

  it('flags a missing stock number', () => {
    expect(kinds(sale({ stockNo: null }))).toContain('NO_STOCK_NO')
  })

  it('does not ask a commission for a stock number it cannot have', () => {
    // A commission is a fee on somebody else's watch; a buy-back charge is
    // interest. Neither has stock under it.
    expect(kinds(sale({ stockNo: null, costGbp: 0, stockless: true }))).toEqual([])
  })
})

describe('a cost of zero', () => {
  it('is an error on a trade or retail sale', () => {
    // It reports as 100% margin, which flatters every total it reaches.
    expect(kinds(sale({ costGbp: 0, channel: 'RETAIL' }))).toContain('ZERO_COST')
    expect(kinds(sale({ costGbp: 0, channel: 'TRADE' }))).toContain('ZERO_COST')
  })

  it('says nothing to a reader who is not shown the cost', () => {
    // The column is NOT NULL in the database, so a null here can only mean
    // redacted. Flagging it would show somebody an error about a figure
    // they cannot see and nobody else can reproduce.
    expect(kinds(sale({ costGbp: null, channel: 'TRADE' }))).not.toContain('ZERO_COST')
  })

  it('is expected on a commission line', () => {
    // Alex: "Commission lines have no cost by definition."
    expect(kinds(sale({ costGbp: 0, channel: 'COMMISSION', stockless: true })))
      .not.toContain('ZERO_COST')
  })

  it('is left alone on the channels the rule does not name', () => {
    expect(kinds(sale({ costGbp: 0, channel: 'CONSIGNMENT' }))).not.toContain('ZERO_COST')
  })
})

describe('unpaid and past due are not the same question', () => {
  it('does not flag an unpaid invoice that is not due yet', () => {
    // 30-day terms raised yesterday: unpaid and perfectly healthy.
    expect(kinds(sale({ paymentStatus: 'PENDING', dueOn: day('2026-11-25') })))
      .not.toContain('PAST_DUE')
  })

  it('flags one that is past its date', () => {
    const flags = flagsFor(
      sale({ paymentStatus: 'PENDING', dueOn: day('2026-10-20') }),
      { now: NOW },
    )
    expect(flags.map((f) => f.kind)).toContain('PAST_DUE')
    expect(flags.find((f) => f.kind === 'PAST_DUE')?.detail).toBe('7 days past the due date')
  })

  it('does not chase a paid invoice whose date has passed', () => {
    expect(kinds(sale({ paymentStatus: 'PAID', dueOn: day('2026-10-20') })))
      .not.toContain('PAST_DUE')
  })

  it('falls back to Xero’s own verdict where there is no due date', () => {
    expect(kinds(sale({ paymentStatus: 'OVERDUE', dueOn: null }))).toContain('PAST_DUE')
  })
})

describe('missing from the accounts', () => {
  const lastImport = {
    id: 'xim_1',
    coversFrom: day('2026-10-01'),
    coversTo: day('2026-10-31'),
  }

  it('flags a sale inside the period the import covered', () => {
    expect(kinds(sale({ saleDate: day('2026-10-15') }), { lastImport })).toContain('NOT_IN_XERO')
  })

  it('says nothing about a sale the import did account for', () => {
    expect(kinds(sale({ saleDate: day('2026-10-15'), xeroSeenImportId: 'xim_1' }), { lastImport }))
      .not.toContain('NOT_IN_XERO')
  })

  it('does not flag the whole back catalogue', () => {
    // A month of Xero invoices says nothing about a sale from two years
    // ago, and flagging every one of them is how a flag gets ignored.
    expect(kinds(sale({ saleDate: day('2024-03-02') }), { lastImport })).not.toContain('NOT_IN_XERO')
  })

  it('says nothing at all before the first import', () => {
    expect(kinds(sale({ saleDate: day('2026-10-15') }))).not.toContain('NOT_IN_XERO')
  })

  it('does not flag on an import that recorded no dates', () => {
    expect(kinds(sale(), { lastImport: { id: 'xim_1', coversFrom: null, coversTo: null } }))
      .not.toContain('NOT_IN_XERO')
  })
})

describe('how loud each one is', () => {
  it('separates what misstates the books from what is untidy', () => {
    expect(flagTone('ZERO_COST')).toBe('serious')
    expect(flagTone('NOT_IN_XERO')).toBe('serious')
    expect(flagTone('PAST_DUE')).toBe('serious')
    expect(flagTone('NO_CUSTOMER')).toBe('warning')
    expect(flagTone('INVOICE_TBA')).toBe('warning')
  })

  it('has a label for every flag', () => {
    for (const kind of Object.keys(FLAG_LABELS)) {
      expect(FLAG_LABELS[kind as keyof typeof FLAG_LABELS]).toBeTruthy()
    }
  })
})

describe('a sale with everything wrong', () => {
  it('reports all of it at once', () => {
    const flags = kinds(
      sale({
        invoiceNo: 'TBA', saleDate: day('2026-10-01'), customerName: null, stockNo: null,
        costGbp: 0, channel: 'TRADE', paymentStatus: 'PENDING', dueOn: day('2026-10-15'),
      }),
      { lastImport: { id: 'xim_1', coversFrom: day('2026-10-01'), coversTo: day('2026-10-31') } },
    )
    expect(flags).toEqual([
      'INVOICE_TBA', 'NO_CUSTOMER', 'NO_STOCK_NO', 'ZERO_COST', 'PAST_DUE', 'NOT_IN_XERO',
    ])
  })
})

/**
 * Alex, looking at the ledger straight after an import: "Once reconciled
 * it is not correct as they have been linked with Xero."
 *
 * Every commission and every buy-back charge on the screen was flagged
 * "Not in Xero" despite carrying an invoice number from that very import.
 * Two causes, both real: `applyImport` marked only sales as seen, and the
 * ledger hard-coded the seen-import to null for the other two kinds. So
 * the flag was structurally incapable of ever clearing for them.
 */
describe('a reconciled commission or charge stops saying "Not in Xero"', () => {
  const lastImport = { id: 'xim_1', coversFrom: day('2026-10-01'), coversTo: day('2026-10-31') }
  const inPeriod = { saleDate: day('2026-10-22'), stockless: true, stockNo: null, costGbp: 0 }

  it('clears once the import has accounted for it', () => {
    expect(kinds(sale({ ...inPeriod, channel: 'COMMISSION', xeroSeenImportId: 'xim_1' }), { lastImport }))
      .not.toContain('NOT_IN_XERO')
  })

  it('still flags one the import never saw', () => {
    expect(kinds(sale({ ...inPeriod, channel: 'COMMISSION', xeroSeenImportId: null }), { lastImport }))
      .toContain('NOT_IN_XERO')
  })

  it('clears for a buy-back charge too', () => {
    expect(kinds(sale({ ...inPeriod, channel: 'BUYBACK', xeroSeenImportId: 'xim_1' }), { lastImport }))
      .not.toContain('NOT_IN_XERO')
  })

  it('flags again after a later import that did not account for it', () => {
    // The flag is about the *last* import, so an older one does not count.
    expect(kinds(sale({ ...inPeriod, channel: 'COMMISSION', xeroSeenImportId: 'xim_0' }),
      { lastImport: { ...lastImport, id: 'xim_2' } })).toContain('NOT_IN_XERO')
  })
})
