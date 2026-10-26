import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { can } from '@/lib/permissions'
import { navGroups } from '@/components/layout/nav-model'
import { inventoryViews } from '@/components/inventory/views'

const inventoryPage = readFileSync(join(process.cwd(), 'src/app/(app)/inventory/page.tsx'), 'utf8')

const counts = {
  inStock: 181, unpriced: 7, ageing: 23, sales: 12, openDeals: 6,
  openRequests: 11, tasksDue: 48, tradeEnquiries: 0,
}
const labelsFor = (role: Parameters<typeof navGroups>[0]) =>
  navGroups(role, counts).flatMap((group) => group.items.map((item) => item.label))

/**
 * What a salesperson can see of the firm, as against of the stock.
 *
 * The role is defined around one line: all three prices on a watch, and
 * nothing about the business's own position. Cost and revenue are held for
 * the lookup — the owner's own instruction — and the capital position is
 * not. Three screens were quietly on the wrong side of that line, and each
 * reached the role through a capability granted for a different purpose.
 */
describe('what Sales is shown', () => {
  it('still gets all three prices on a watch', () => {
    // The thing the role exists for. Narrowing the views above must not
    // narrow this.
    expect(can('SALES', 'cost:read')).toBe(true)
    expect(can('SALES', 'revenue:read')).toBe(true)
    expect(can('SALES', 'watch:read')).toBe(true)
  })

  it('is not shown the Owners page', () => {
    // One page, and it states the capital position per backer.
    expect(can('SALES', 'owner:read')).toBe(false)
    expect(labelsFor('SALES')).not.toContain('Owners')
  })

  it('is not given a worklist it cannot clear', () => {
    // Unpriced stock stood in the sidebar as a standing task with a number
    // on it, for a job the role has no capability to do.
    expect(can('SALES', 'watch:price')).toBe(false)
    expect(labelsFor('SALES')).not.toContain('Unpriced stock')
  })

  it('is not shown the totals across the book', () => {
    // Capital invested, retail and trade value, profit across the stock.
    // Summing figures the role may read one at a time is a different
    // question from reading one of them, and the answer is the firm's own
    // account of itself.
    expect(can('SALES', 'report:read')).toBe(false)
    expect(inventoryPage).toMatch(/const showTotals = can\(user\.role, 'report:read'\)/)
    // Every card that sums the view, rather than counting it.
    for (const card of ['Retail value', 'Est. profit · Retail', 'Capital invested', 'Trade value', 'Est. profit · Trade']) {
      const at = inventoryPage.indexOf(`label="${card}"`)
      expect(at, `${card} not found`).toBeGreaterThan(-1)
      // The guard sits just above the card it governs.
      expect(inventoryPage.slice(Math.max(0, at - 220), at)).toContain('showTotals')
    }
  })

  it('keeps the count of what is in view, which is not a total', () => {
    // "In view: 181" is how many rows the filter matched. It says nothing
    // about money and it is the one card that should survive.
    const at = inventoryPage.indexOf('label="In view"')
    expect(inventoryPage.slice(Math.max(0, at - 220), at)).not.toContain('showTotals')
  })

  it('does not narrow anybody above Sales', () => {
    for (const role of ['STAFF', 'MANAGER', 'OWNER'] as const) {
      expect(can(role, 'owner:read'), `${role} lost owner:read`).toBe(true)
      expect(can(role, 'report:read'), `${role} lost report:read`).toBe(true)
      expect(labelsFor(role)).toContain('Owners')
      expect(labelsFor(role)).toContain('Unpriced stock')
    }
  })
})

/**
 * The stock list itself, once the role was narrowed around it.
 *
 * Alex: "These views not needed for sales they should only see OSW stock",
 * "Remove amount invested", "and 138 view is repeated" — three things on one
 * screen, and the first two are the same mistake twice. A total gated on the
 * capability for reading one watch's cost rather than on the capability for
 * reading the firm's account of itself is how a figure survives its own
 * cards being taken away.
 */
describe('the stock list a salesperson opens', () => {
  const house = { id: 'loc-1', name: 'One Street Watches' }

  it('offers Sales the shop floor and nothing else', () => {
    const labels = inventoryViews(house, { queues: false }).map((v) => v.label)
    expect(labels).toEqual(['One Street Watches'])
  })

  it('still offers the queues to the people whose job they are', () => {
    const labels = inventoryViews(house, { queues: true }).map((v) => v.label)
    expect(labels).toContain('One Street Watches')
    for (const queue of ['All locations', 'Sold', 'Needs a price', 'Register check due', 'Ageing']) {
      expect(labels).toContain(queue)
    }
  })

  it('gives every role that works the book its queues back', () => {
    // The gate the page computes. Sales is the only role on the wrong side
    // of it, which is the point: a capability nobody else lacks would have
    // taken the bar away from Operations too.
    const worksTheBook = (role: Parameters<typeof can>[0]) =>
      can(role, 'report:read') || can(role, 'watch:update')
    expect(worksTheBook('SALES')).toBe(false)
    for (const role of ['VIEWER', 'OPERATIONS', 'STAFF', 'MANAGER', 'OWNER'] as const) {
      expect(worksTheBook(role)).toBe(true)
    }
  })

  it('says nothing about capital in the subtitle', () => {
    // The leak: `showCost` is held by Sales, `showTotals` is not.
    expect(inventoryPage).toContain("description={showTotals && showCost ? `${money(summary.totalCostGbp)} invested` : undefined}")
    expect(inventoryPage).not.toContain('description={showCost')
  })

  it('does not print the same count twice', () => {
    // "138 watches matching the current view" over a card reading "In view
    // 138". The card keeps it; the subtitle stops repeating it.
    expect(inventoryPage).not.toContain('matching the current view')
    expect(inventoryPage).toContain('<StatCard label="In view" value={summary.inStockCount}')
  })
})
