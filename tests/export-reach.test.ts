import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The stock export was unreachable from a phone: hidden from the header on
 * the understanding that it folded into the overflow menu, and never added
 * to that menu. Both halves are pinned here.
 */

describe('the stock export can be reached from a phone', () => {
  const page = readFileSync('src/app/(app)/inventory/page.tsx', 'utf8')
  const actions = readFileSync('src/components/layout/PageActions.tsx', 'utf8')

  it('is listed in the overflow menu, which is the only route below sm', () => {
    expect(page).toMatch(/id: 'export'/)
    expect(page).toMatch(/href: exportHref/)
  })

  it('is offered only to a role that may export', () => {
    expect(page).toMatch(/capabilities\['report:export'\]\n?\s*\? \[\{ id: 'export'/)
  })

  it('hands the file to the browser rather than pushing a route', () => {
    // router.push cannot start a download; pointed at an API route it goes
    // nowhere, so the menu item would have looked present and done nothing.
    expect(actions).toMatch(/if \(action\.download\) window\.location\.href = action\.href/)
    expect(actions).toMatch(/download\?: boolean/)
    expect(page).toMatch(/download: true/)
  })

  it('says it exports the view rather than everything', () => {
    // The default view is a single location. A file of part of the book
    // labelled "Export" is the kind of thing somebody reconciles against.
    expect(page).toMatch(/label: 'Export this view'/)
  })
})
