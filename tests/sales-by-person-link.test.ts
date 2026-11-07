import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFilters, SALE_FIELDS } from '@/lib/filters'
import { feeArms, soldByClause } from '@/server/services/sales-ledger'
import type { SaleQuery } from '@/server/repositories/sale-repository'

const read = (path: string) => readFileSync(path, 'utf8')
const people = read('src/app/(app)/reports/people/page.tsx')
const salesPage = read('src/app/(app)/sales/page.tsx')
const ledger = read('src/server/services/sales-ledger.ts')
const brokerage = read('src/server/services/brokerage-service.ts')
const buyback = read('src/server/services/buyback-service.ts')

/** A query as the link now builds it, through the page's own parser. */
const asQuery = (search: string): SaleQuery => {
  const params = new URLSearchParams(search)
  return { f: parseFilters(params, SALE_FIELDS) } as SaleQuery
}

/**
 * Clicking a person on the sales-by-person report.
 *
 * Alex: "This seems to be ok but when you click into the sales it doesn't
 * show the correct sales for this month it shows a random list."
 *
 * The bar linked to `/sales?q=<their name>`. That search does cover the
 * salesperson's name, which is why it looked right — but it also covers the
 * invoice number, the buyer and the model, it carried no period at all, and
 * a text search drops both fee ledgers. So it answered with every month
 * there has ever been, included anyone else's sale to a customer of the
 * same name, and showed a fraction of the figure it was attached to.
 *
 * Run against a real database: the report counts four deals for a person
 * and the link returns those same four, including a charge due at 14:00 on
 * the last day of the month.
 */

describe('the ledger can be asked who sold it', () => {
  it('offers the field at all', () => {
    // The repository could already filter this column — it is in the
    // filterable map — and nothing could ask, because the field was not on
    // the list the interface and the URL are built from.
    const field = SALE_FIELDS.find((spec) => spec.key === 'soldById')
    expect(field).toBeDefined()
    expect(field!.type).toBe('reference')
    expect(field!.optionSource).toBe('salesPeople')
  })

  it('parses the clause the link writes', () => {
    const query = asQuery('f=soldById%3Ais%3Aslp_1')
    expect(query.f).toEqual([{ field: 'soldById', operator: 'is', values: ['slp_1'] }])
  })

  it('is offered the people to choose from, not a box to type an id into', () => {
    expect(salesPage).toMatch(/salesPeople: salesPeople\.map/)
  })
})

describe('a person’s fees come with their sales', () => {
  it('keeps both fee ledgers for a soldById clause', () => {
    /*
     * Every other field drops them, because the clause runs in SQL against
     * the sales table and the fee ledgers are not in it. This one is
     * answered by passing the person down to the fee queries instead.
     */
    expect(feeArms(asQuery('f=soldById%3Ais%3Aslp_1')))
      .toEqual({ commissions: true, charges: true })
  })

  it('hands the person down, and only when it is one person', () => {
    // "Is not Alex" over three people is a question about the sales table's
    // rows, not a person a fee query can be given.
    expect(soldByClause(asQuery('f=soldById%3Ais%3Aslp_1'))).toBe('slp_1')
    expect(soldByClause(asQuery('f=soldById%3AisNot%3Aslp_1'))).toBeUndefined()
    expect(soldByClause(asQuery('f=soldById%3Ais%3Aslp_1%7Cslp_2'))).toBeUndefined()
    expect(soldByClause(asQuery(''))).toBeUndefined()
  })

  it('still drops them for a clause they cannot answer', () => {
    expect(feeArms(asQuery('f=paymentStatus%3Ais%3APENDING')))
      .toEqual({ commissions: false, charges: false })
    // Including one alongside a person: that is the other question again.
    expect(feeArms(asQuery('f=soldById%3Ais%3Aslp_1&f=paymentStatus%3Ais%3APENDING')))
      .toEqual({ commissions: false, charges: false })
  })

  it('composes with a channel chip rather than fighting it', () => {
    expect(feeArms(asQuery('f=soldById%3Ais%3Aslp_1&f=channel%3Ais%3ACOMMISSION')))
      .toEqual({ commissions: true, charges: false })
  })

  it('reaches every fee query, not just the listing', () => {
    for (const [name, source, fn] of [
      ['brokerages', brokerage, 'listBrokerages'],
      ['charges', buyback, 'listBuybackCharges'],
    ] as const) {
      expect(source.slice(source.indexOf(`export async function ${fn}`)), name)
        .toMatch(/soldById\?: string/)
    }
    expect(ledger).toMatch(/listBrokerages\(query\.from, query\.to, MERGE_CAP, person\)/)
    expect(ledger).toMatch(/listBuybackCharges\(query\.from, query\.to, MERGE_CAP, person\)/)
  })
})

describe('the link the bar carries', () => {
  it('names the person and the period, not their name as text', () => {
    expect(people).toMatch(/href: person\.id \? salesLink\(person\.id, from, to\) : undefined/)
    expect(people).toMatch(/params\.set\('f', `soldById:is:\$\{personId\}`\)/)
    expect(people).toMatch(/params\.set\('from'/)
    expect(people).toMatch(/params\.set\('to'/)
  })

  it('no longer searches the ledger for their name', () => {
    expect(people).not.toMatch(/\/sales\?q=\$\{encodeURIComponent\(person\.name\)\}/)
  })
})

describe('the figures on the screen agree with the rows', () => {
  it('counts all three income sources in the header, once', () => {
    /*
     * The header added stock sales and brokered fees and stopped, so a
     * buy-back charge made it disagree with the card beside it: 3 over 5
     * over a table of 4. Both now read the same expression.
     */
    expect(salesPage).toMatch(/const ledgerCount = summary\.count \+ brokerTotals\.count \+ interest\.count/)
    expect(salesPage).toMatch(/\$\{ledgerCount\} \$\{ledgerCount === 1 \? 'sale' : 'sales'\} in this view/)
    expect(salesPage).toMatch(/value=\{ledgerCount\}/)
  })

  it('narrows the totals to the person the table is narrowed to', () => {
    // The arms decide whether a fee ledger is counted; this decides whose.
    expect(salesPage).toMatch(/brokerageTotals\(brokerFrom, brokerTo, person\)/)
    expect(salesPage).toMatch(/buybackTotals\(brokerFrom, brokerTo, person\)/)
    expect(salesPage).toMatch(/const person = soldByClause\(query\)/)
  })

  it('takes a date range to the end of its last day', () => {
    /*
     * "2026-11-30" parsed plainly is 00:00 on the 30th. A sale date is
     * stored at midnight and survived it; a commission or a charge carries
     * a time and did not, so the last day of any range lost its fees.
     */
    expect(salesPage).toMatch(/to: searchParams\.to \? endOfDay\(String\(searchParams\.to\)\) : undefined/)
    expect(salesPage).toMatch(/parsed\.getTime\(\) \+ 86_399_999/)
    // Only for a bare day: a full timestamp was asked for exactly.
    expect(salesPage).toContain('if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value.trim())) return parsed')
  })
})
