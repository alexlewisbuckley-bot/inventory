import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const service = readFileSync('src/server/services/catalogue-service.ts', 'utf8')
const page = readFileSync('src/app/(app)/catalogue/page.tsx', 'utf8')
const filters = readFileSync('src/components/catalogue/CatalogueFilters.tsx', 'utf8')

/**
 * The cuts a dealer makes.
 *
 * The catalogue had a brand menu and a search box; the inventory has had
 * the rest for months and the trade room has had them since it was built.
 * A dealer reading two hundred pieces to find the three they deal in was
 * doing it with a text box.
 */
describe('what the trade catalogue can be cut by', () => {
  const asked = ['family', 'dial', 'material', 'wears', 'size', 'year', 'condition', 'boxPapers']

  it.each(asked)('filters on %s', (key) => {
    expect(service).toMatch(new RegExp(`query\\.${key}`))
  })

  it('offers each of them a menu', () => {
    for (const key of asked) expect(filters, key).toMatch(new RegExp(`key: '${key}'`))
  })

  it('is a closed list, not the inventory filter engine', () => {
    // That engine can express supplier, owner, location, cost and margin.
    // This is the one read whose audience is not us, and a generic filter
    // here would be one forgotten exclusion from answering a question
    // about our business.
    expect(service).not.toMatch(/filtersToSql/)
    for (const forbidden of ['supplierId', 'ownerId', 'purchasePrice', 'locationId']) {
      expect(service, forbidden).not.toMatch(new RegExp(`query\\.${forbidden}`))
    }
  })

  it('checks the closed lists rather than trusting the URL', () => {
    // These are compared against enum columns; an unknown value is a type
    // error at best and a confusing empty grid at worst.
    expect(page).toMatch(/oneOf<Wears>\(WEARS,/)
    expect(page).toMatch(/oneOf<Condition>\(CONDITIONS,/)
    expect(page).toMatch(/oneOf<BoxPapers>\(BOX_PAPERS,/)
    // And the numbers are numbers.
    expect(page).toMatch(/Number\.isInteger\(value\) && value > 0/)
  })
})

describe('the menus', () => {
  it('count against the other filters but not their own', () => {
    // Pick Rolex and the dial counts should narrow, but the brand menu
    // must still offer Patek or choosing a filter is a door that locks.
    expect(service).toMatch(/const others = \(self: keyof CatalogueFacets\)/)
    expect(service).toMatch(/key === self \|\| tests\[key\]\(row\)/)
  })

  it('are counted in one read rather than nine', () => {
    // Nine grouped queries to say this is worse than one read and some
    // arithmetic, at a few hundred rows.
    const fn = service.slice(service.indexOf('export async function catalogueFacets'))
    const upTo = fn.slice(0, fn.indexOf('function wearsOf'))
    expect(upTo.match(/await db\s*\n?\s*\.select/g)?.length ?? upTo.match(/db\s*$/gm)?.length).toBeTruthy()
    expect((upTo.match(/\.from\(watches\)/g) ?? []).length).toBe(1)
  })

  it('never offer a choice with no stock behind it', () => {
    // Options are built by walking the rows that survive the other
    // filters, so a value only exists in the menu if a watch produced it.
    expect(service).toMatch(/for \(const row of rows\.filter\(others\(self\)\)\)/)
  })

  it('hide themselves when there is nothing to choose between', () => {
    expect(filters).toMatch(/facets\[menu\.from\]\.length > 1/)
  })

  it('stay on screen when the grid is empty', () => {
    // A dealer who has filtered down to nothing needs the controls that
    // got them there, not a dead end with the way out removed.
    const grid = readFileSync('src/components/catalogue/CatalogueGrid.tsx', 'utf8')
    const before = grid.indexOf('<CatalogueFilters')
    const empty = grid.indexOf('result.items.length === 0')
    expect(before).toBeGreaterThan(-1)
    expect(before).toBeLessThan(empty)
  })
})

describe('worn by', () => {
  it('reads the case size with the storefront thresholds', () => {
    // So the shop, the book and the catalogue sort the same watch the
    // same way rather than three ways.
    expect(service).toMatch(/WOMENS_MAX_MM/)
    expect(service).toMatch(/MENS_MIN_MM/)
  })

  it('puts a watch with no case size in neither', () => {
    // We do not know, and guessing puts a man's watch in front of
    // somebody shopping for their wife.
    expect(service).toMatch(/if \(size === null\) return \[\]/)
    expect(service).toMatch(/caseSizeMm\} is not null/)
  })
})

describe('the grouping SQL', () => {
  it('is shared with the inventory rather than copied', () => {
    // The two have to agree about what a model, a dial and a metal are,
    // or the same watch files under "Pink" in one place and "Pink,
    // diamond-set" in the other.
    const shared = readFileSync('src/server/repositories/watch-sql.ts', 'utf8')
    expect(shared).toMatch(/export \{ FAMILY_SQL, DIAL_SQL, MATERIAL_SQL, headOf \}/)
    expect(service).toMatch(/from '@\/server\/repositories\/watch-sql'/)
    const repo = readFileSync('src/server/repositories/watch-repository.ts', 'utf8')
    expect(repo).toMatch(/from '\.\/watch-sql'/)
    // One definition, not two.
    expect(repo).not.toMatch(/const FAMILY_SQL = /)
    expect(service).not.toMatch(/const FAMILY_SQL = /)
  })
})
