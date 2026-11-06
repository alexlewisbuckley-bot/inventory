import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { matchInvoices, type SaleCandidate } from '@/lib/xero-match'
import type { XeroInvoice } from '@/lib/xero-invoice'

const read = (path: string) => readFileSync(path, 'utf8')
const review = read('src/components/sales/ReconcileReview.tsx')
const service = read('src/server/services/xero-service.ts')

const day = (d: string) => new Date(`${d}T00:00:00.000Z`)
/** USD into dirhams, as the invoice on screen converted 11,500 to 42,232.83. */
const toBase = (minor: number, ccy: string) => (ccy === 'USD' ? Math.round(minor * 3.6725) : minor)

const invoice = (over: Partial<XeroInvoice> = {}): XeroInvoice => ({
  invoiceNo: 'INV-0125',
  contactName: 'Simeon Andrew Zacharias',
  invoiceDate: day('2026-11-02'),
  currency: 'USD',
  total: 1_150_000,
  status: 'PAID',
  reference: '',
  lines: [],
  dueDate: null,
  paidDate: null,
  ...over,
} as unknown as XeroInvoice)

const sale = (id: string, usd: number, name = 'Simon Zach', d = '2026-11-01'): SaleCandidate => ({
  id, kind: 'SALE', stockNo: Number(id.replace(/\D/g, '')) || null, invoiceNo: null,
  customerName: name, saleDate: day(d), amountBase: toBase(usd * 100, 'USD'),
} as unknown as SaleCandidate)

const matchedOf = (invoices: XeroInvoice[], sales: SaleCandidate[]) => {
  const result = matchInvoices(invoices, sales, { toBase })
  return {
    ids: (result.matched[0]?.sales ?? []).map((s) => s.saleId).sort(),
    tiers: [...new Set((result.matched[0]?.sales ?? []).map((s) => s.tier))],
    alias: result.matched[0]?.proposedAlias ?? null,
  }
}

/**
 * One invoice, several watches.
 *
 * Alex: "Here's an example of 2 watch sales that make up 1 invoice with no
 * way to reconcile together, please think about this process and how our
 * system can support and report and document this type of sale correctly."
 *
 * INV-0125 is USD 11,500 and the two sales are 6,200 and 5,300. Every tier
 * compared one sale to the whole total, so 6,200 against 11,500 is a 46%
 * drift and nothing matched — and the screen then said "nothing in the
 * system matches this invoice", which was wrong twice over.
 *
 * Run against a real database and a real browser: the pair found and
 * allocated to the cent, the alias offered, a watch unlinked and put back
 * through a picker that used to vanish, and the amount change that falls
 * out of a half-linked invoice arriving unticked.
 */

describe('finding the watches that add up to an invoice', () => {
  it('finds the pair on Alex’s invoice', () => {
    const found = matchedOf([invoice()], [sale('s33', 6200), sale('s15', 5300)])
    expect(found.ids).toEqual(['s15', 's33'])
    expect(found.tiers).toEqual(['combination'])
  })

  it('does it on a contact name no threshold would pass', () => {
    /*
     * "Simeon Andrew Zacharias" against our "Simon Zach" is why every
     * other tier failed. What makes a combination believable is not the
     * name: it is that the parts are all one customer of ours, bought in
     * the same few days, and add up.
     */
    const found = matchedOf([invoice()], [sale('a', 6200), sale('b', 5300)])
    expect(found.ids).toHaveLength(2)
  })

  it('offers the name pair to the alias list, which is the point', () => {
    // The arithmetic had to identify this invoice precisely because the
    // names do not look alike. That is the pair worth remembering.
    const found = matchedOf([invoice()], [sale('a', 6200), sale('b', 5300)])
    expect(found.alias).toEqual({ systemName: 'Simon Zach', xeroName: 'Simeon Andrew Zacharias' })
  })

  it('leaves a third watch of theirs that is not on the invoice', () => {
    const found = matchedOf([invoice()], [sale('a', 6200), sale('b', 5300), sale('c', 9000)])
    expect(found.ids).toEqual(['a', 'b'])
  })

  it('takes three when three is what adds up', () => {
    const found = matchedOf([invoice()], [sale('a', 4000), sale('b', 4000), sale('c', 3500)])
    expect(found.ids).toEqual(['a', 'b', 'c'])
  })
})

describe('what it refuses to guess', () => {
  it('will not build a combination out of two different customers', () => {
    // An invoice is to one contact. Two unrelated sales that happen to sum
    // to the total are a coincidence, not a reading of it.
    expect(matchedOf([invoice()], [
      sale('a', 6200, 'Simon Zach'), sale('b', 5300, 'Someone Else'),
    ]).ids).toEqual([])
  })

  it('stands back where one of theirs answers the whole invoice', () => {
    /*
     * One watch on one invoice is the likelier reading of the two, and a
     * wrong combination is two sales to unpick rather than one. Tiers 3
     * and 4 take it when the name allows; where it does not, saying
     * nothing beats guessing across rows.
     */
    expect(matchedOf([invoice()], [
      sale('whole', 11500), sale('a', 6200), sale('b', 5300),
    ]).ids).toEqual([])
  })

  it('will not reach outside the week', () => {
    expect(matchedOf([invoice()], [
      sale('a', 6200, 'Simon Zach', '2026-09-01'),
      sale('b', 5300, 'Simon Zach', '2026-09-01'),
    ]).ids).toEqual([])
  })

  it('will not take a pair that does not add up', () => {
    expect(matchedOf([invoice()], [sale('a', 6200), sale('b', 1000)]).ids).toEqual([])
  })

  it('runs last, so a single confident match always wins', () => {
    // An invoice number names one sale outright; the combination pass only
    // ever sees invoices nothing else could account for.
    const named = { ...sale('named', 11500), invoiceNo: 'INV-0125' } as SaleCandidate
    const found = matchedOf([invoice()], [named, sale('a', 6200), sale('b', 5300)])
    expect(found.ids).toEqual(['named'])
    expect(found.tiers).toEqual(['invoice'])
  })

  it('stays cheap on a customer with a lot of stock that week', () => {
    const many = Array.from({ length: 40 }, (_, i) => sale(`m${i}`, 1000 + i * 37))
    const started = Date.now()
    matchInvoices([invoice()], many, { toBase })
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('the screen', () => {
  it('keeps the picker whatever is already linked', () => {
    /*
     * The whole of "no way to reconcile together". The picker was inside
     * the branch for an invoice with nothing against it, so linking the
     * first watch took the control away and the second could never be
     * added — the one case it was needed for.
     */
    expect(review).toMatch(/\{!review\.appliedAt && review\.unmatchedSales\.length > 0 && \(/)
    expect(review).toMatch(/Add another from the book…/)
  })

  it('says what is still missing, in base', () => {
    // The parts can be in different currencies, and the invoice total is
    // the only thing they all have to agree with.
    expect(review).toMatch(/of this invoice is not accounted for yet/)
    expect(review).toMatch(/invoice\.totalBase\s*\n?\s*- invoice\.sales\.reduce\(\(sum, sale\) => sum \+ sale\.ownBase, 0\)/)
  })

  it('reads the gap off the sales, not off the allocation', () => {
    /*
     * The allocation is forced to sum to the invoice, so one watch linked
     * to a two-watch invoice is allocated the whole of it and can never
     * show a gap. Only what the sales say they were for can.
     */
    const sale = service.slice(service.indexOf('export interface ReviewSale'))
    expect(sale.slice(0, sale.indexOf('}'))).toMatch(/ownBase: number/)
    expect(service).toMatch(/ownBase: sale\.amountBase,/)
  })

  it('does not shout about a rounding', () => {
    // Each sale converted at its own rate on its own day, the invoice at
    // the rate on its: the two sides differ by pennies as a matter of
    // course. A missing watch is a third of the invoice.
    expect(review).toMatch(/Math\.abs\(shortfall\) > invoice\.totalBase \* 0\.01/)
  })
})

describe('the amount change a half-linked invoice proposes', () => {
  it('arrives unticked', () => {
    /*
     * Unlink one watch of a pair and the other is allocated the whole
     * invoice, which proposes "USD 5,300.00 → USD 11,500.00" against a
     * sale that was right. Ticked, Apply would overwrite a correct figure
     * with the total of an invoice covering a watch that is not on screen.
     */
    expect(review).toMatch(/adrift && change\.field === 'saleAmount'/)
    expect(review).toMatch(/Math\.abs\(owed\) > invoice\.totalBase \* 0\.01/)
  })

  it('arrives unticked even though it appeared mid-import', () => {
    // A key nobody has seen is a key nobody has cleared, so it would
    // otherwise default to ticked — backwards for a line the screen has
    // just decided it is unsure about.
    expect(review).toMatch(/const fresh = probableKeys\.filter\(\(key\) => !seenKeys\.has\(key\)\)/)
    expect(review).toMatch(/setOff\(\(current\) => new Set\(\[\.\.\.current, \.\.\.fresh\]\)\)/)
  })

  it('shows a combination as a suggestion rather than a finding', () => {
    expect(review).toMatch(/tier === 'probable' \|\| tier === 'combination'/)
    expect(review).toMatch(/combination: 'this and the others add up to the invoice'/)
  })
})

describe('the alias a combination proves', () => {
  it('is offered however many sales are linked', () => {
    /*
     * This asked for exactly one linked sale, which excluded the case the
     * alias list is most useful for: a combination is found by arithmetic
     * precisely because the contact name matched nothing.
     */
    expect(service).toMatch(/const names = new Set\(/)
    expect(service).toMatch(/reviewSales\.length > 0 && names\.size === 1/)
    expect(service).not.toMatch(/reviewSales\.length === 1 \? byId/)
  })

  it('still says nothing where the linked sales disagree about the customer', () => {
    // A hand-linked mixture of two customers teaches nothing.
    expect(service).toMatch(/names\.size === 1/)
  })
})
