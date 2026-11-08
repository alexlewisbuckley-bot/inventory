import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isPlaceholderInvoiceNo, normaliseInvoiceNo } from '@/lib/xero-match'
import { groupUnpaidByInvoice } from '@/server/services/insights-service'

const read = (path: string) => readFileSync(path, 'utf8')
const repo = read('src/server/repositories/sale-repository.ts')
const insights = read('src/server/services/insights-service.ts')

/**
 * "TBC" is not an invoice number.
 *
 * Alex, on two single sales a day apart: "these new sales say 2 watches
 * which is incorrect they are both single sales."
 *
 * invoice_no is a required column, so a sale made before its invoice is
 * written carries a word meaning "not yet" — the team types TBC. Anything
 * that treats that word as an identity gathers unrelated sales under it.
 * Three places did: the ledger's "N watches" badge, the unpaid-invoice
 * chase list, and the Xero matcher, whose own rule knew about TBA and TBD
 * and not the letter actually in use.
 */

const unpaid = (over: Partial<Parameters<typeof groupUnpaidByInvoice>[0][number]> = {}) => ({
  id: 'sal_1', invoiceNo: 'INV-1', amountGbp: 1000,
  saleDate: new Date('2026-11-01'), customerName: 'Chrono Hub', ...over,
})

describe('what counts as an invoice number', () => {
  it('knows the word the team actually types', () => {
    // The rule read /^TB[AD]/. It had been written for TBA and TBD, and
    // TBC fell through it into every grouping downstream.
    expect(isPlaceholderInvoiceNo('TBC')).toBe(true)
    expect(isPlaceholderInvoiceNo('tbc')).toBe(true)
    expect(isPlaceholderInvoiceNo(' TBC ')).toBe(true)
    expect(isPlaceholderInvoiceNo('TBC-2')).toBe(true)
  })

  it('knows the other ways of writing "not yet"', () => {
    for (const text of ['TBA', 'TBD', '', '   ', '-', '–', '—', '?', 'N/A', 'na', 'None', 'nil', 'pending', 'Awaiting']) {
      expect(isPlaceholderInvoiceNo(text), JSON.stringify(text)).toBe(true)
    }
    expect(isPlaceholderInvoiceNo(null)).toBe(true)
  })

  it('does not swallow a real reference that happens to start the same way', () => {
    // A rule that reaches too far is the same bug facing the other way:
    // real invoices stop grouping with their own lines.
    for (const text of ['INV-1', '116503', 'TBCO-99', 'NAPLES-4', 'PENDING-12', 'X-TBC-7']) {
      expect(isPlaceholderInvoiceNo(text), text).toBe(false)
    }
  })

  it('compares two spellings of one reference as one', () => {
    expect(normaliseInvoiceNo(' inv-9 ')).toBe(normaliseInvoiceNo('INV-9'))
    expect(normaliseInvoiceNo('inv 9')).toBe(normaliseInvoiceNo('INV_9'))
    expect(normaliseInvoiceNo('INV-9')).not.toBe(normaliseInvoiceNo('INV-8'))
  })
})

describe('the "N watches" badge on the ledger', () => {
  it('asks the shared rule rather than comparing the text itself', () => {
    expect(repo).toMatch(/import \{ isPlaceholderInvoiceNo, normaliseInvoiceNo \} from '@\/lib\/xero-match'/)
    expect(repo).toMatch(/references\.filter\(\(ref\) => !isPlaceholderInvoiceNo\(ref\)\)\.map\(normaliseInvoiceNo\)/)
  })

  it('reads a placeholder as a single line', () => {
    // Absent from the map, because it was never counted: one line.
    expect(repo).toMatch(/invoiceLines: lines\.get\(normaliseInvoiceNo\(row\.invoiceNo\)\) \?\? 1/)
  })

  it('no longer counts siblings by raw text in SQL', () => {
    /*
     * The old count was a correlated subquery matching invoice_no exactly.
     * It grouped every TBC in the book together, and it failed to group
     * "INV-9" with " inv-9 ", which is the same invoice typed twice.
     */
    expect(repo).not.toMatch(/WHERE line\.invoice_no =/)
  })

  it('matches the text in SQL the way normaliseInvoiceNo does', () => {
    // Two implementations of the same normalisation, so they are pinned
    // against each other: trim, upper-case, drop spaces and underscores.
    expect(repo).toContain("upper(regexp_replace(btrim(${sales.invoiceNo}), '[\\s_]+', '', 'g'))")
    expect(normaliseInvoiceNo(' a b_c ')).toBe('AB C'.replace(' ', ''))
  })
})

describe('the unpaid-invoice chase list', () => {
  it('keeps two un-invoiced debts apart', () => {
    /*
     * This is the one that could cost money. Grouped by invoice_no in SQL,
     * two customers who both had sales awaiting an invoice became a single
     * chase item, under min(customer_name), for the sum of the two. The
     * other customer was not on the list at all, so nobody asked them.
     */
    const groups = groupUnpaidByInvoice([
      unpaid({ id: 'sal_1', invoiceNo: 'TBC', customerName: 'Chrono Hub', amountGbp: 2_500_000 }),
      unpaid({ id: 'sal_2', invoiceNo: 'TBC', customerName: 'A Jewellers', amountGbp: 4_800_000 }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.customerName)).toEqual(['Chrono Hub', 'A Jewellers'])
    expect(groups.map((g) => g.amountGbp)).toEqual([2_500_000, 4_800_000])
    expect(groups.every((g) => g.lines === 1)).toBe(true)
    // Distinct keys, or React renders one and drops the other.
    expect(new Set(groups.map((g) => g.key)).size).toBe(2)
  })

  it('still gathers the lines of a real invoice into one job', () => {
    // The reason grouping exists: chasing one payment is one job however
    // many watches it bought.
    const groups = groupUnpaidByInvoice([
      unpaid({ id: 'sal_1', invoiceNo: 'INV-9', amountGbp: 1_000, saleDate: new Date('2026-11-05') }),
      unpaid({ id: 'sal_2', invoiceNo: ' inv-9 ', amountGbp: 2_000, saleDate: new Date('2026-11-01') }),
      unpaid({ id: 'sal_3', invoiceNo: 'Inv-9', amountGbp: 4_000, saleDate: new Date('2026-11-09') }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].lines).toBe(3)
    expect(groups[0].amountGbp).toBe(7_000)
    // Waiting since its earliest line, not since whichever row came first.
    expect(groups[0].saleDate).toEqual(new Date('2026-11-01'))
    expect(groups[0].invoiced).toBe(true)
  })

  it('treats a hyphen as part of the reference, not as noise', () => {
    /*
     * Case and spacing are typing; a hyphen may be the reference. This
     * rule is shared with the Xero matcher, where reaching too far pairs a
     * payment with the wrong invoice — a worse outcome than a badge that
     * does not appear. So INV-9 and INV9 stay two references, and a sale
     * typed either way simply does not gather with the other.
     */
    expect(normaliseInvoiceNo('INV_9')).not.toBe(normaliseInvoiceNo('INV-9'))
    expect(groupUnpaidByInvoice([
      unpaid({ id: 'sal_1', invoiceNo: 'INV-9' }),
      unpaid({ id: 'sal_2', invoiceNo: 'INV9' }),
    ])).toHaveLength(2)
  })

  it('takes a name from a later line when the first has none', () => {
    const groups = groupUnpaidByInvoice([
      unpaid({ id: 'sal_1', invoiceNo: 'INV-9', customerName: null }),
      unpaid({ id: 'sal_2', invoiceNo: 'INV-9', customerName: 'A Jewellers' }),
    ])
    expect(groups[0].customerName).toBe('A Jewellers')
  })

  it('links a placeholder to its sale, not to a search for everything', () => {
    // /sales?invoice=TBC asks for every sale not yet invoiced.
    expect(insights).toMatch(/group\.invoiced \? `\/sales\?invoice=\$\{group\.invoiceNo\}` : `\/sales\/\$\{group\.saleId\}`/)
    expect(groupUnpaidByInvoice([unpaid({ invoiceNo: 'TBC' })])[0].invoiced).toBe(false)
    expect(groupUnpaidByInvoice([unpaid({ invoiceNo: 'INV-9' })])[0].invoiced).toBe(true)
  })

  it('no longer groups by the raw column in SQL', () => {
    expect(insights).not.toMatch(/\.groupBy\(sales\.invoiceNo\)/)
    expect(insights).toMatch(/\.limit\(UNPAID_SCAN_CAP\)/)
  })
})
