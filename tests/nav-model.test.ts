import { describe, expect, it } from 'vitest'
import { flattenNav, isActive, navGroups } from '@/components/layout/nav-model'

const COUNTS = { inStock: 26, unpriced: 7, ageing: 26, sales: 3 }
const groups = navGroups('OWNER', COUNTS)
const items = flattenNav(groups)
const activeFor = (pathname: string) =>
  items.filter((item) => isActive(item, pathname, items)).map((item) => item.label)

describe('navigation highlighting', () => {
  it('marks exactly one destination as current, whatever the path', () => {
    // /settings/users is matched by both "Settings" and "Users". Lighting both
    // left the user unsure which section they were actually in.
    for (const path of ['/', '/inventory', '/inventory/new', '/sales', '/suppliers',
                        '/locations', '/reports', '/reports/ageing', '/settings',
                        '/settings/users', '/settings/currencies', '/settings/audit']) {
      expect(activeFor(path), `for ${path}`).toHaveLength(1)
    }
  })

  it('gives the most specific destination the highlight', () => {
    expect(activeFor('/settings/users')).toEqual(['Users'])
    expect(activeFor('/settings/currencies')).toEqual(['Settings'])
    expect(activeFor('/reports/ageing')).toEqual(['Ageing stock'])
  })

  it('never highlights a saved-view shortcut from a section prefix', () => {
    // "Unpriced stock" is /inventory?unpricedOnly=true; it must not light up
    // for the whole inventory section.
    expect(activeFor('/inventory')).toEqual(['Inventory'])
  })

  it('highlights nothing for a path outside the navigation', () => {
    expect(activeFor('/notifications')).toHaveLength(0)
  })

  it('hides destinations a role cannot reach', () => {
    const viewer = flattenNav(navGroups('VIEWER', COUNTS)).map((i) => i.label)
    expect(viewer).not.toContain('Users')
    expect(viewer).toContain('Inventory')
  })
})
