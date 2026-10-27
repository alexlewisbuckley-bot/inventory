import { describe, expect, it } from 'vitest'
import {
  matchInvoices, nameSimilarity, mentionsStockNo, isPlaceholderInvoiceNo,
  looksLikeBuyBack, NAME_THRESHOLD, type SaleCandidate,
} from '@/lib/xero-match'
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

const sale = (over: Partial<SaleCandidate> = {}): SaleCandidate => ({
  id: 's1',
  stockNo: 1366,
  invoiceNo: 'INV-0241',
  customerName: 'Sweepings Hands',
  saleDate: day('2026-10-14'),
  amountBase: 10_000_000,
  ...over,
})

/** AED is base here, so only a real conversion moves a figure. */
const toBase = (amount: number, currency: string) =>
  currency === 'USD' ? Math.round(amount * 3.6725) : amount

describe('matching in order of confidence', () => {
  it('takes the invoice number first', () => {
    const { matched } = matchInvoices([invoice()], [sale()], { toBase })
    expect(matched).toHaveLength(1)
    expect(matched[0]!.sales).toEqual([{ saleId: 's1', tier: 'invoice' }])
  })

  it('ignores spacing and case in an invoice number', () => {
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-0241' })],
      [sale({ invoiceNo: ' inv-0241 ' })],
      { toBase },
    )
    expect(matched[0]!.sales[0]!.tier).toBe('invoice')
  })

  it('never matches on a TBA, however many sales carry one', () => {
    // The thing the whole feature exists to clear. Matching on it would
    // pair Xero with whichever TBA sale came first in the list.
    const { matched, unmatchedInvoices } = matchInvoices(
      [invoice({ invoiceNo: 'TBA-01', contactName: 'Nobody', total: 1 })],
      [sale({ id: 'a', invoiceNo: 'TBA-01', stockNo: null, customerName: null }),
       sale({ id: 'b', invoiceNo: 'TBA-02', stockNo: null, customerName: null })],
      { toBase },
    )
    expect(matched).toHaveLength(0)
    expect(unmatchedInvoices).toHaveLength(1)
  })

  it('falls to the stock number when the invoice number is not there yet', () => {
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-9999', reference: 'Stock 1366' })],
      [sale({ invoiceNo: 'TBA-01' })],
      { toBase },
    )
    expect(matched[0]!.sales).toEqual([{ saleId: 's1', tier: 'stock' }])
  })

  it('reads a stock number out of a line description', () => {
    const { matched } = matchInvoices(
      [invoice({
        invoiceNo: 'INV-9999',
        lines: [{ description: 'Rolex Daytona (stock 1366)', amount: null, quantity: 1 }],
      })],
      [sale({ invoiceNo: null })],
      { toBase },
    )
    expect(matched[0]!.sales[0]!.tier).toBe('stock')
  })

  it('links two watches to one invoice', () => {
    // Alex: "An invoice can link to multiple sales."
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-9999', reference: 'Stock 1366 and 1372' })],
      [sale({ id: 'a', stockNo: 1366, invoiceNo: null }),
       sale({ id: 'b', stockNo: 1372, invoiceNo: null })],
      { toBase },
    )
    expect(matched[0]!.sales.map((s) => s.saleId)).toEqual(['a', 'b'])
  })

  it('falls to the customer, amount and date together', () => {
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-9999', contactName: 'Trendsourcing Dubai' })],
      [sale({ invoiceNo: null, stockNo: null, customerName: 'Trend Sourcing' })],
      { toBase },
    )
    expect(matched[0]!.sales).toEqual([{ saleId: 's1', tier: 'fuzzy' }])
    expect(matched[0]?.proposedAlias).toEqual({
      systemName: 'Trend Sourcing', xeroName: 'Trendsourcing Dubai',
    })
  })

  it('will not match on the name alone when the amount is out', () => {
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-9999', total: 10_000_000 })],
      [sale({ invoiceNo: null, stockNo: null, amountBase: 10_900_000 })],
      { toBase },
    )
    expect(matched).toHaveLength(0)
  })

  it('allows the 1% the amounts really do drift by', () => {
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-9999', total: 10_000_000 })],
      [sale({ invoiceNo: null, stockNo: null, amountBase: 10_090_000 })],
      { toBase },
    )
    expect(matched[0]!.sales[0]!.tier).toBe('fuzzy')
  })

  it('converts before it compares', () => {
    // Alex: "Never compare amounts across currencies without converting
    // first." USD 92,000.00 is AED 337,870 at 3.6725.
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-9999', currency: 'USD', total: 9_200_000 })],
      [sale({ invoiceNo: null, stockNo: null, amountBase: 33_787_000 })],
      { toBase },
    )
    expect(matched[0]!.sales[0]!.tier).toBe('fuzzy')
  })

  it('will not match on the name alone when the date is weeks out', () => {
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-9999', invoiceDate: day('2026-10-14') })],
      [sale({ invoiceNo: null, stockNo: null, saleDate: day('2026-09-14') })],
      { toBase },
    )
    expect(matched).toHaveLength(0)
  })

  it('allows the three days between invoicing and booking', () => {
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-9999', invoiceDate: day('2026-10-14') })],
      [sale({ invoiceNo: null, stockNo: null, saleDate: day('2026-10-17') })],
      { toBase },
    )
    expect(matched[0]!.sales[0]!.tier).toBe('fuzzy')
  })

  it('leaves everything else to the user', () => {
    const { matched, unmatchedInvoices, unmatchedSaleIds } = matchInvoices(
      [invoice({ invoiceNo: 'INV-9999', contactName: 'Someone Else' })],
      [sale({ id: 'x', invoiceNo: null, stockNo: null, customerName: 'Nobody Alike' })],
      { toBase },
    )
    expect(matched).toHaveLength(0)
    expect(unmatchedInvoices.map((i) => i.invoiceNo)).toEqual(['INV-9999'])
    expect(unmatchedSaleIds).toEqual(['x'])
  })
})

describe('an exact match is never beaten by a weaker one', () => {
  it('does not let an earlier invoice take a sale a later one owns exactly', () => {
    // The reason the tiers run as passes over every invoice rather than
    // each invoice running down all four on its own. Taken invoice by
    // invoice, the first one here would claim the sale on a fuzzy hit and
    // the invoice whose number actually matches would be left with nothing.
    const sales = [sale({ id: 's1', invoiceNo: 'INV-0242', customerName: 'Sweepings Hands' })]
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-0241' }), invoice({ invoiceNo: 'INV-0242' })],
      sales,
      { toBase },
    )
    expect(matched).toHaveLength(1)
    expect(matched[0]).toMatchObject({ invoiceNo: 'INV-0242' })
    expect(matched[0]!.sales[0]!.tier).toBe('invoice')
  })

  it('claims a sale once', () => {
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-0241' }), invoice({ invoiceNo: 'INV-0241' })],
      [sale({ id: 's1' })],
      { toBase },
    )
    expect(matched.flatMap((m) => m.sales.map((s) => s.saleId))).toEqual(['s1'])
  })
})

describe('the alias table', () => {
  it('matches a pair no fuzziness could reach', () => {
    // Alex's own example. These two names share nothing at all, which is
    // exactly why an alias table has to exist.
    expect(nameSimilarity('Henry Fisher', 'Sweepings Hands')).toBeLessThan(NAME_THRESHOLD)

    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-9999', contactName: 'Sweepings Hands' })],
      [sale({ invoiceNo: null, stockNo: null, customerName: 'Henry Fisher' })],
      { toBase, aliases: [{ systemName: 'Henry Fisher', xeroName: 'Sweepings Hands' }] },
    )
    expect(matched[0]!.sales[0]!.tier).toBe('fuzzy')
  })

  it('proposes nothing when the two names already agree', () => {
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-9999', contactName: 'Sweepings Hands' })],
      [sale({ invoiceNo: null, stockNo: null, customerName: 'sweepings hands' })],
      { toBase },
    )
    expect(matched[0]?.proposedAlias).toBeNull()
  })
})

describe('the pieces', () => {
  it('scores the names that really do differ', () => {
    expect(nameSimilarity('Trend Sourcing', 'Trendsourcing Dubai')).toBeGreaterThan(NAME_THRESHOLD)
    expect(nameSimilarity('A. Dealer & Co', 'A Dealer and Co')).toBeGreaterThan(NAME_THRESHOLD)
    expect(nameSimilarity('Sweepings Hands', 'Sweeping Hands')).toBeGreaterThan(NAME_THRESHOLD)
  })

  it('does not score two different dealers as one', () => {
    expect(nameSimilarity('Al Majid Watches', 'Al Habtoor Watches')).toBeLessThan(NAME_THRESHOLD)
    expect(nameSimilarity('Henry Fisher', 'Henry Fishman')).toBeLessThan(NAME_THRESHOLD)
  })

  it('does not find 1366 inside a longer number', () => {
    expect(mentionsStockNo('Stock 1366', 1366)).toBe(true)
    expect(mentionsStockNo('ref:1366.', 1366)).toBe(true)
    expect(mentionsStockNo('1366/1372', 1366)).toBe(true)
    expect(mentionsStockNo('serial 113669', 1366)).toBe(false)
    expect(mentionsStockNo('13660', 1366)).toBe(false)
  })

  it('knows a placeholder invoice number', () => {
    expect(isPlaceholderInvoiceNo('TBA')).toBe(true)
    expect(isPlaceholderInvoiceNo('TBA-01')).toBe(true)
    expect(isPlaceholderInvoiceNo('tbd')).toBe(true)
    expect(isPlaceholderInvoiceNo('')).toBe(true)
    expect(isPlaceholderInvoiceNo(null)).toBe(true)
    expect(isPlaceholderInvoiceNo('INV-0241')).toBe(false)
  })

  it('spots a Buy Back by name', () => {
    expect(looksLikeBuyBack(invoice({ reference: 'Buy Back - Mr Haddad' }))).toBe(true)
    expect(looksLikeBuyBack(invoice({
      lines: [{ description: 'Buyback settlement', amount: null, quantity: null }],
    }))).toBe(true)
    expect(looksLikeBuyBack(invoice({ reference: 'Stock 1366' }))).toBe(false)
  })
})

/**
 * The failure Alex described as "the system shows it as two unrelated
 * lines", found by running a real export through the page.
 *
 * One Xero invoice covering two watches, where the first watch already
 * carries the invoice number and the second is named only in the
 * reference. Tier 1 used to settle the whole invoice on the first, and the
 * second was never looked for.
 */
describe('an invoice keeps collecting watches after its first hit', () => {
  const two = invoice({
    invoiceNo: 'INV-9001',
    reference: 'Stock 1364 and 1144',
    total: 29_700_001,
  })

  it('links both watches, each by how it was found', () => {
    const { matched } = matchInvoices(
      [two],
      [
        sale({ id: 'known', stockNo: 1364, invoiceNo: 'INV-9001', customerName: null }),
        sale({ id: 'hidden', stockNo: 1144, invoiceNo: 'TBA-01', customerName: null }),
      ],
      { toBase },
    )
    expect(matched).toHaveLength(1)
    expect(matched[0]!.sales).toEqual([
      { saleId: 'known', tier: 'invoice' },
      { saleId: 'hidden', tier: 'stock' },
    ])
  })

  it('leaves neither of them in the unmatched list', () => {
    const { unmatchedSaleIds, unmatchedInvoices } = matchInvoices(
      [two],
      [
        sale({ id: 'known', stockNo: 1364, invoiceNo: 'INV-9001', customerName: null }),
        sale({ id: 'hidden', stockNo: 1144, invoiceNo: 'TBA-01', customerName: null }),
      ],
      { toBase },
    )
    expect(unmatchedSaleIds).toEqual([])
    expect(unmatchedInvoices).toEqual([])
  })

  it('still will not run the weakest tier on an invoice that found something', () => {
    // Tier 3 picks one best sale on three weak signals. An invoice that
    // already has a firm match must not also acquire a guess.
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-0241', total: 10_000_000 })],
      [
        sale({ id: 'firm', invoiceNo: 'INV-0241', stockNo: null, customerName: null }),
        sale({ id: 'guess', invoiceNo: null, stockNo: null, customerName: 'Sweepings Hands' }),
      ],
      { toBase },
    )
    expect(matched[0]!.sales.map((s) => s.saleId)).toEqual(['firm'])
  })
})

describe('a file that repeats an invoice number', () => {
  it('reads two rows as two invoices, not one', () => {
    // A credit note often carries the number it credits, and an export can
    // simply contain the same invoice twice. Keyed by number, both rows
    // collapsed into one entry and were each handed the same sale.
    const { matched } = matchInvoices(
      [invoice({ invoiceNo: 'INV-0241' }), invoice({ invoiceNo: 'INV-0241' })],
      [sale({ id: 's1' })],
      { toBase },
    )
    expect(matched).toHaveLength(1)
    expect(matched.flatMap((m) => m.sales.map((s) => s.saleId))).toEqual(['s1'])
    expect(matched[0]!.at).toBe(0)
  })
})
