import { describe, expect, it } from 'vitest'
import { flattenNav, isActive, navGroups } from '@/components/layout/nav-model'

const COUNTS = {
  inStock: 26, unpriced: 7, ageing: 26, sales: 3,
  openDeals: 8, tasksDue: 2, openRequests: 4, tradeEnquiries: 1,
}
const groups = navGroups('OWNER', COUNTS)
const items = flattenNav(groups)
const activeFor = (pathname: string) =>
  items.filter((item) => isActive(item, pathname, items)).map((item) => item.label)

describe('navigation highlighting', () => {
  it('marks exactly one destination as current, whatever the path', () => {
    // Two destinations lit at once left the user unsure which section they
    // were actually in, so a sidebar path must resolve to exactly one.
    for (const path of ['/today', '/insights', '/inventory', '/inventory/new', '/images', '/sales',
                        '/suppliers', '/locations', '/owners', '/reports', '/reports/ageing']) {
      expect(activeFor(path), `for ${path}`).toHaveLength(1)
    }
  })

  /**
   * Settings, Users and Help live in the account menu and the command palette,
   * not in the sidebar. Nothing in the sidebar is the section you are in while
   * you are in one of them, so nothing lights up — highlighting a neighbour
   * would be worse than highlighting nothing.
   */
  it('highlights no sidebar section for the account-menu destinations', () => {
    for (const path of ['/settings', '/settings/users', '/settings/currencies', '/settings/audit']) {
      expect(activeFor(path), `for ${path}`).toHaveLength(0)
    }
  })

  it('gives the most specific destination the highlight', () => {
    expect(activeFor('/reports/ageing')).toEqual(['Ageing stock'])
    expect(activeFor('/owners')).toEqual(['Owners'])
  })

  it('never highlights a saved-view shortcut from a section prefix', () => {
    // "Unpriced stock" is /inventory?unpricedOnly=true; it must not light up
    // for the whole inventory section.
    expect(activeFor('/inventory')).toEqual(['Inventory'])
  })

  it('highlights nothing for a path outside the navigation', () => {
    expect(activeFor('/notifications')).toHaveLength(0)
    // `/` is a redirect to Today, not a destination. Nobody is ever sitting on
    // it long enough for a highlight to mean anything.
    expect(activeFor('/')).toHaveLength(0)
  })

  it('hides destinations a role cannot reach', () => {
    const viewer = flattenNav(navGroups('VIEWER', COUNTS)).map((i) => i.label)
    expect(viewer).not.toContain('Users')
    expect(viewer).toContain('Inventory')
  })
})
