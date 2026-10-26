import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WATCH_FIELDS } from '@/lib/filters'
import { withoutDescription } from '@/lib/shopify-metafields'
import { AVAILABLE_QUERY, inventoryViews, locationQuery } from '@/components/inventory/views'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('filtering by dial and metal', () => {
  it('offers both as questions the list can be asked', () => {
    const keys = WATCH_FIELDS.map((field) => field.key)
    expect(keys).toContain('dial')
    expect(keys).toContain('material')
  })

  it('offers them as references rather than enums', () => {
    // An enum's values are checked against a closed list, and these are
    // whatever is in the case this morning. Declared as an enum the filter
    // passes every check and then has its values stripped on the way to the
    // query, which silently returns the whole book — it happened to `family`.
    for (const key of ['dial', 'material']) {
      expect(WATCH_FIELDS.find((field) => field.key === key)?.type).toBe('reference')
    }
  })

  it('counts and matches on the same coarsened value', () => {
    // Two expressions for "the thing itself" would mean a menu offering
    // Pink and a filter finding nothing: the facet is grouped by one and
    // the clause matched by the other.
    // The fragments live in watch-sql.ts now: the trade catalogue needed
    // the same answers, and a second copy would have drifted the first
    // time one was tuned.
    const shared = read('src/server/repositories/watch-sql.ts')
    expect(shared).toMatch(/const DIAL_SQL = headOf\(watches\.dial\)/)
    expect(shared).toMatch(/const MATERIAL_SQL = headOf\(watches\.caseMaterial\)/)
    const repo = read('src/server/repositories/watch-repository.ts')
    expect(repo).toMatch(/match: \(value\) => sql`\$\{DIAL_SQL\} = \$\{value\}`/)
    expect(repo).toMatch(/\.groupBy\(DIAL_SQL\)/)
    expect(repo).toMatch(/\.groupBy\(MATERIAL_SQL\)/)
  })

  it('cuts where the storefront cuts', () => {
    // The Postgres and the TypeScript are stated separately because neither
    // can call the other. These are the cases that have to agree.
    expect(withoutDescription('Pink, diamond-set')).toBe('Pink')
    expect(withoutDescription('Oyster (72419)')).toBe('Oyster')
    expect(withoutDescription('Black with grey subdials')).toBe('Black')
    expect(withoutDescription('Champagne')).toBe('Champagne')
    const shared = read('src/server/repositories/watch-sql.ts')
    // The same three delimiters, case-insensitively, and never down to blank.
    expect(shared).toMatch(/'\(,\|\\\\\(\| with \)\.\*\$', '', 'i'/)
    expect(shared).toMatch(/>= 2/)
  })

  it('hides a menu with nothing to choose between', () => {
    const bar = read('src/components/inventory/FindBar.tsx')
    expect(bar).toMatch(/facets\.dials\.length > 1 &&/)
    expect(bar).toMatch(/facets\.materials\.length > 1 &&/)
  })
})

describe('where the stock list opens', () => {
  const house = { id: 'loc_1', name: 'One Street Watches' }

  it('opens on the shop, as a view and not a hidden default', () => {
    // A clause you can see is a clause you can take off. One that narrows
    // the list silently is how somebody concludes a watch has gone missing.
    expect(locationQuery(house.id)).toBe(`${AVAILABLE_QUERY}&f=locationId%3Ais%3Aloc_1`)
    expect(inventoryViews(house)[0]).toMatchObject({ id: 'house', label: 'One Street Watches' })
  })

  it('keeps every location one click away', () => {
    const views = inventoryViews(house)
    expect(views.find((view) => view.id === 'all')?.query).toBe(AVAILABLE_QUERY)
    expect(views.find((view) => view.id === 'all')?.label).toBe('All locations')
  })

  it('narrows nothing when there is no shop to open on', () => {
    expect(inventoryViews(null)[0]?.id).toBe('all')
  })

  it('redirects a bare URL to the view, so the chip lights up', () => {
    // ViewBar compares the URL against each view's query as a set, so the
    // landing URL and the house view have to be the same string or the page
    // you arrive on has no chip lit at all.
    const page = read('src/app/(app)/inventory/page.tsx')
    expect(page).toMatch(/redirect\(`\/inventory\?\$\{house \? locationQuery\(house\.id\) : AVAILABLE_QUERY\}`\)/)
    // The second argument decides whether the queues are offered at all
    // (Sales gets the shop floor alone); the house stays the first, which is
    // what this test is about.
    expect(page).toMatch(/builtIn=\{inventoryViews\(house[,)]/)
  })

  it('finds the shop by the order set in Locations, not by its name', () => {
    const page = read('src/app/(app)/inventory/page.tsx')
    expect(page).toMatch(/eq\(locations\.type, 'STORE'\)/)
    expect(page).toMatch(/orderBy\(asc\(locations\.sortOrder\), asc\(locations\.name\)\)/)
    expect(page).not.toMatch(/'One Street Watches'/)
  })
})
