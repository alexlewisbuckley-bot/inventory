import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { can, customerScope } from '@/lib/permissions'

/**
 * The Sales seat, as the owner specified it: the stock list with all three
 * prices, their own clients, and nothing else of the firm's.
 */

describe('their own clients, enforced in the query', () => {
  const repo = readFileSync('src/server/repositories/crm-repository.ts', 'utf8')
  const list = readFileSync('src/app/(app)/customers/page.tsx', 'utf8')
  const record = readFileSync('src/app/(app)/customers/[id]/page.tsx', 'utf8')

  it('narrows by owner in SQL, not with a filter on the screen', () => {
    // The list already takes an ownerId filter from the address bar. A
    // filter is a default and a default is removed by editing the URL, so
    // the scope has to be a clause the caller cannot express.
    expect(repo).toMatch(/if \(ownedBy\) clauses\.push\(eq\(customers\.ownerId, ownedBy\)\)/)
    expect(repo).toMatch(/ownedBy\?: string \| null/)
  })

  it('passes the viewer\'s own id when that is their scope', () => {
    expect(list).toMatch(/findCustomers\(query, scope === 'own' \? user\.id : null\)/)
    expect(list).toMatch(/customerScope\(user\.role\)/)
  })

  it('closes the deep link round a scoped list', () => {
    // The record has its own address and somebody can be sent one.
    expect(record).toMatch(/customerScope\(user\.role\) === 'own' && row\.customer\.ownerId !== user\.id\) notFound\(\)/)
  })

  it('opens the page to either capability, so the narrow one still gets in', () => {
    for (const source of [list, record]) {
      expect(source).toMatch(/requireAnyCapability\('customer:read', 'customer:own'\)/)
    }
  })
})

describe('what the owner asked to be taken away', () => {
  it('no shop content', () => {
    const nav = readFileSync('src/components/layout/nav-model.ts', 'utf8')
    const page = readFileSync('src/app/(app)/inventory/content/page.tsx', 'utf8')
    // Gated on being able to change a watch, which is what every action on
    // that page already required.
    expect(nav).toMatch(/'\/inventory\/content'.*capability: 'watch:update'/)
    expect(page).toMatch(/requireCapability\('watch:update'\)/)
    expect(can('SALES', 'watch:update')).toBe(false)
  })

  it('no deals, tasks or wanted', () => {
    expect(can('SALES', 'deal:read')).toBe(false)
    expect(can('SALES', 'task:read')).toBe(false)
    expect(can('SALES', 'request:read')).toBe(false)
  })

  it('no suppliers', () => {
    expect(can('SALES', 'supplier:read')).toBe(false)
  })

  it('no sales ledger', () => {
    expect(can('SALES', 'sale:read')).toBe(false)
    // Their own figures are a different question and stay.
    expect(can('SALES', 'report:own')).toBe(true)
  })

  it('not the whole customer book', () => {
    expect(can('SALES', 'customer:read')).toBe(false)
    expect(customerScope('SALES')).toBe('own')
  })
})

describe('what Sales keeps', () => {
  it('stock checks, which the owner asked to leave', () => {
    const checks = readFileSync('src/app/(app)/stock-checks/page.tsx', 'utf8')
    expect(checks).toMatch(/requireCapability\('watch:read'\)/)
    expect(can('SALES', 'watch:read')).toBe(true)
    // Readable, but every write on it needs a capability they do not hold.
    expect(can('SALES', 'watch:move')).toBe(false)
  })

  it('the stock list with all three prices', () => {
    expect(can('SALES', 'watch:read')).toBe(true)
    expect(can('SALES', 'cost:read')).toBe(true)
    expect(can('SALES', 'revenue:read')).toBe(true)
  })
})

describe('the menus match what the role can actually open', () => {
  const nav = readFileSync('src/components/layout/nav-model.ts', 'utf8')
  const bar = readFileSync('src/components/layout/BottomBar.tsx', 'utf8')

  it('still links Customers for a role scoped to their own', () => {
    // The link was gated on customer:read, so a salesperson could reach the
    // page by typing the address and found no way in from the menu.
    expect(nav).toMatch(/'\/customers'.*anyOf: \['customer:read', 'customer:own'\]/)
    expect(nav).toMatch(/if \(item\.anyOf\) return canAny\(role, item\.anyOf\)/)
  })

  it('stops the phone bar offering doors that refuse', () => {
    // It had no capability check at all: four tabs, two of them into
    // "Not part of your role" for this seat.
    expect(bar).toMatch(/anyOf: \['deal:read'\]/)
    expect(bar).toMatch(/anyOf: \['customer:read', 'customer:own'\]/)
    expect(bar).toMatch(/ITEMS\.filter\(\(item\) => !item\.anyOf \|\| canAny\(role, item\.anyOf\)\)/)
  })

  it('leaves Today and Search open to everyone who can sign in', () => {
    expect(bar).toMatch(/label: 'Today', icon: LayoutDashboard, match: '\/today' \}/)
    expect(bar).toMatch(/label: 'Search', icon: Search, match: '\/search' \}/)
  })
})
