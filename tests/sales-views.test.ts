import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { feeArms } from '@/server/services/sales-ledger'
import { parseFilters, SALE_FIELDS } from '@/lib/filters'
import { SALES_VIEWS } from '@/components/sales/views'
import type { SaleQuery } from '@/server/repositories/sale-repository'

const read = (path: string) => readFileSync(path, 'utf8')
const page = read('src/app/(app)/sales/page.tsx')
const views = read('src/components/sales/views.ts')

/** What the bar would send, run through the page's own parser. */
const armsForView = (id: string) => {
  const view = SALES_VIEWS.find((v) => v.id === id)
  if (!view) throw new Error(`no view ${id}`)
  const params = new URLSearchParams(view.query)
  return feeArms({ f: parseFilters(params, SALE_FIELDS) } as SaleQuery)
}

/**
 * Tabs on the sales ledger.
 *
 * Alex: "Still can't see tabs." The saved-view machinery has accepted `sale`
 * as an object since it was built — the enum value, the label, the service,
 * the actions, even `/sales` in the list the save action revalidates — and no
 * page ever rendered the bar, so the feature existed everywhere except on
 * screen.
 *
 * Run against a real database and a real browser: each chip filtering to its
 * own rows, the stat cards agreeing with the rows under them, and the chip
 * lighting up when the same filter is built by hand. What is kept here is
 * everything provable without either.
 */

describe('the bar is on the page at all', () => {
  it('is rendered, with the object the saved views are stored under', () => {
    expect(page).toMatch(/<ViewBar object="sale" builtIn=\{SALES_VIEWS\} saved=\{savedViews\} \/>/)
    expect(page).toMatch(/listViews\('sale', user\.id\)/)
  })

  it('sits above the two bars that narrow it', () => {
    // A view is which list you are looking at; the date range and the filter
    // bar are how you narrow the one you chose.
    expect(page.indexOf('<ViewBar')).toBeLessThan(page.indexOf('<SalesFilterBar'))
    expect(page.indexOf('<ViewBar')).toBeLessThan(page.indexOf('<FilterBar'))
  })
})

describe('each chip asks for its own rows', () => {
  it('opens on everything, with an empty query', () => {
    /*
     * An empty query rather than a filter that happens to match all of it:
     * the bar compares the URL to a view's query as a set, so this is the
     * chip that lights up when nothing is filtered, which is how the page
     * opens.
     */
    expect(SALES_VIEWS[0]!.id).toBe('all')
    expect(SALES_VIEWS[0]!.query).toBe('')
    expect(armsForView('all')).toEqual({ commissions: true, charges: true })
  })

  it('keeps the commissions on the commission chip', () => {
    expect(armsForView('commission')).toEqual({ commissions: true, charges: false })
  })

  it('keeps the charges on the buy-back chip', () => {
    expect(armsForView('buyback')).toEqual({ commissions: false, charges: true })
  })

  it('drops both on the stock chip', () => {
    // The only rows with a cost under them.
    expect(armsForView('stock')).toEqual({ commissions: false, charges: false })
  })

  it('writes the stock chip as "not the fee kinds", not as a list of channels', () => {
    /*
     * So a channel added later lands in the stock list instead of quietly
     * falling out of every view — the same reasoning as `isNot SOLD` on the
     * stock list.
     */
    const stock = SALES_VIEWS.find((v) => v.id === 'stock')!
    expect(decodeURIComponent(stock.query)).toBe('f=channel:isNot:COMMISSION|BUYBACK')
  })

  it('writes every query in the grammar the filter bar writes', () => {
    // So a chip lights up when somebody builds the same filter by hand, and
    // saving a hand-built filter produces something that sits beside these.
    for (const view of SALES_VIEWS) {
      if (!view.query) continue
      const clauses = parseFilters(new URLSearchParams(view.query), SALE_FIELDS)
      expect(clauses.length, view.id).toBeGreaterThan(0)
    }
  })

  it('ships no view that would quietly answer for stock only', () => {
    /*
     * An "unpaid" or "awaiting despatch" chip is tempting and would be
     * wrong: a clause on any field but channel is applied in SQL against
     * the sales table, which the fee ledgers are not in, so such a view
     * drops them without saying so. A built-in that is wrong about a third
     * of the ledger is worse than one somebody builds and knows the shape
     * of.
     */
    for (const view of SALES_VIEWS) {
      const clauses = parseFilters(new URLSearchParams(view.query), SALE_FIELDS)
      for (const clause of clauses) expect(clause.field, view.id).toBe('channel')
    }
  })
})

describe('the cards answer for the rows under them', () => {
  it('counts a fee ledger only when the view holds it', () => {
    /*
     * Both totals only ever took dates, so they counted every fee in the
     * period whatever else was filtered. Invisible while no filter could
     * separate the kinds; with a chip for each, the Commission view
     * headlined "2 brokered · 1 buy-back" over a list of two commissions,
     * and the revenue card added a buy-back the list did not contain.
     */
    expect(page).toMatch(/arms\.commissions \? brokerageTotals\(brokerFrom, brokerTo, person\) : Promise\.resolve\(noFees\)/)
    expect(page).toMatch(/arms\.charges \? buybackTotals\(brokerFrom, brokerTo, person\) : Promise\.resolve\(noFees\)/)
    expect(page).toMatch(/const arms = feeArms\(query\)/)
  })

  it('says nothing rather than zero where there is no margin to state', () => {
    // Zero prints as "0.0%", which reads as "we made nothing on these"
    // rather than "this does not apply". The same rule the table already
    // follows for a fee's own margin.
    expect(page).toMatch(/summary\.count > 0 \? formatPct\(summary\.avgMarginBps \/ 100\) : '—'/)
  })
})

describe('the views file', () => {
  it('records why there is no unpaid chip', () => {
    // So the next person does not add one and find out the hard way.
    expect(views).toMatch(/feeArms/)
  })
})
