import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { can } from '@/lib/permissions'
import { navGroups } from '@/components/layout/nav-model'

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
