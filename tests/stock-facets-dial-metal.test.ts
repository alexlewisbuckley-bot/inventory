import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WATCH_FIELDS } from '@/lib/filters'
import { withoutDescription } from '@/lib/shopify-metafields'
import { AVAILABLE_QUERY, inventoryViews } from '@/components/inventory/views'

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
  it('opens on the stock you hold, and says nothing about where it is', () => {
    /*
     * There was a "Stock to hand" view here carrying a clause that excluded
     * the locations marked away. Alex, the next day: "if you make a way to
     * hide from inventory (main dashboard) but trackable only from locations
     * that will be better so it doesn't show the filter toggle at all and the
     * only way to view them is through the location itself."
     *
     * A filter is the list doing something for you that it will stop doing if
     * you ask — so "All locations" sat one click from exactly the stock he
     * had just said should not be there. Held away is now a fact about the
     * stock rather than a clause on the list, so there is no chip, no toggle,
     * and nothing to forget is switched on.
     */
    const labels = inventoryViews().map((view) => view.label)
    expect(labels).not.toContain('Stock to hand')
    expect(labels).not.toContain('All locations')
    expect(inventoryViews()[0]).toMatchObject({ id: 'all', label: 'Stock you hold' })
  })

  it('does not promise every location in a list that no longer has them all', () => {
    // A chip saying "All locations" over a list missing five watches is the
    // one thing worse than not offering it.
    const all = inventoryViews().find((view) => view.id === 'all')
    expect(all?.query).toBe(AVAILABLE_QUERY)
    expect(all?.description).toContain('held away is on its location')
  })

  it('redirects a bare URL to the view, so the chip lights up', () => {
    // ViewBar compares the URL against each view's query as a set, so the
    // landing URL and the first view have to be the same string or the page
    // you arrive on has no chip lit at all.
    const page = read('src/app/(app)/inventory/page.tsx')
    expect(page).toContain('redirect(`/inventory?${AVAILABLE_QUERY}`)')
    // And it no longer computes which locations to exclude, because the list
    // is not excluding them — it never had them.
    expect(page).not.toContain('awayLocations')
    expect(page).not.toContain('toHandQuery')
  })

  it('leaves held-away stock off the list whatever the URL asks for', () => {
    /*
     * The toggle is gone, so this must not be reachable by typing. The
     * clause is in the repository, keyed off a scope the query schema cannot
     * carry — a field there is a field a salesperson can put in a link.
     */
    const repo = read('src/server/repositories/watch-repository.ts')
    expect(repo).toContain('if (!scope.heldAway) {')
    expect(repo).toContain('IN (SELECT l.id FROM locations l WHERE l.is_on_hand)')
    const validation = read('src/lib/validation.ts')
    expect(validation).not.toContain('heldAway')
  })

  it('counts the same stock in the tiles as it lists underneath them', () => {
    // Tiles totalling watches the list below cannot show is a page arguing
    // with itself about what the book is.
    const repo = read('src/server/repositories/watch-repository.ts')
    for (const fn of ['findWatches', 'summariseInventory', 'stockFacets']) {
      expect(repo).toMatch(new RegExp(`export async function ${fn}\\(query: WatchQuery, scope: StockScope`))
    }
  })

  it('has already said Hong Kong is not within reach', () => {
    /*
     * The switch was right and leaving it unticked was not. Alex had already
     * made the call, in the sentence that started the whole change — "ALL
     * EXCEPT IN TRANSIT AND OVERSEAS FOR EXAMPLE HONG KONG" — and then had
     * to go and find a checkbox to say it a second time. He didn't, and the
     * stock list spent a day offering him watches in another country.
     */
    const migration = read('src/server/db/migrations/0066_hong_kong_is_not_to_hand.sql')
    expect(migration).toMatch(/UPDATE locations/)
    expect(migration).toMatch(/is_on_hand = false/)
    expect(migration).toMatch(/lower\(name\) LIKE '%hong kong%'/)
    // The switch stays: a location that starts being somewhere people fly to
    // and back from in a day is a tick away from counting as to hand again.
    expect(migration).not.toMatch(/DROP COLUMN/)
  })

  it('has said the same about America', () => {
    // Alex, the day after: "Also make USA not shown in default." Overseas
    // from a Dubai shop by any reading of it.
    const migration = read('src/server/db/migrations/0067_america_is_not_to_hand.sql')
    expect(migration).toMatch(/is_on_hand = false/)
    expect(migration).toMatch(/united states/)
    /*
     * On whole words, so a location that merely contains those letters is
     * left alone. A bare '%usa%' would quietly take "Thousand Oaks" off the
     * stock list, and nobody would connect the two.
     */
    expect(migration).toMatch(/\(\^\|\[\^a-z\]\)/)
    expect(migration).not.toMatch(/LIKE '%usa%'/)
  })

  it('shows on the location itself whether its stock is within reach', () => {
    /*
     * It was the one of the three settings with nothing on the card, so the
     * only way to see it was to open the row and look — which is why it kept
     * being asked for rather than ticked.
     */
    const manager = read('src/components/reference/LocationManager.tsx')
    expect(manager).toContain('{!location.isOnHand && (')
    expect(manager).toContain('Not to hand')
  })
})

/**
 * One rule, in every direction.
 *
 * Alex: "These should not be shown on the website, in trade acounts or to the
 * sales staff only watches in the UAE active should be within that."
 *
 * Three switches had grown up independently — the website, the trade list,
 * and whether the stock counts as to hand — and nothing kept them in step. It
 * is exactly how Hong Kong ended up off the trade catalogue and still being
 * mirrored to the shop. Held away now settles all of them.
 */
describe('stock held away is off every outward channel', () => {
  const read2 = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

  it('is off the website and the shop mirror', () => {
    expect(read2('src/server/services/catalogue-service.ts')).toContain('eq(locations.isOnHand, true)')
    const shopify = read2('src/server/services/shopify-service.ts')
    expect(shopify).toContain('AND coalesce(${locations.isOnHand}, true)')
    // And it is counted in what the mirror reports as withheld, so the number
    // on that screen and the stock actually missing from the shop agree.
    expect(shopify).toContain('or(eq(locations.publishToStorefront, false), eq(locations.isOnHand, false))')
  })

  it('is off the trade catalogue and the trade room', () => {
    expect(read2('src/server/services/catalogue-link-service.ts')).toContain('eq(locations.isOnHand, true)')
    expect(read2('src/server/services/reseller-service.ts')).toContain('eq(locations.isOnHand, true)')
    // An enquiry cannot start on it either, or the trade room would refuse a
    // watch it had just shown somebody.
    expect(read2('src/server/services/trade-enquiry-service.ts')).toContain('eq(locations.isOnHand, true)')
  })

  it('is off the partner portal, which had no location rule at all', () => {
    /*
     * This was a real leak rather than a missing nicety: `onOffer` asked for
     * IN_STOCK and not deleted and nothing else, so a partner signing in was
     * being shown the Hong Kong vault and whatever was in a courier's bag.
     */
    const portal = read2('src/server/services/partner-portal-service.ts')
    expect(portal).toContain('watches.location_id IN (SELECT l.id FROM locations l WHERE l.is_on_hand)')
  })

  it('is off a reward campaign, where the promise is worse', () => {
    // A campaign is a watch promised to a named person, so offering one in
    // another country is a promise against stock nobody here can reach.
    const campaign = read2('src/server/services/partner-campaign-service.ts')
    expect(campaign).toContain('watches.location_id IN (SELECT l.id FROM locations l WHERE l.is_on_hand)')
  })
})

describe('the location is the one way in', () => {
  const page = readFileSync(join(process.cwd(), 'src/app/(app)/locations/[id]/page.tsx'), 'utf8')

  it('asks for more than the capability a salesperson has', () => {
    /*
     * Sales holds `location:read` so the Locations page can tell them where a
     * watch is. Opening the Hong Kong vault off the same capability would put
     * the stock back in front of the one role Alex said should not see it.
     */
    expect(page).toContain("requireCapability('location:manage')")
    expect(page).not.toContain("requireCapability('location:read')")
  })

  it('is the only list allowed to see held-away stock', () => {
    expect(page).toContain('findWatches(query, { heldAway: true })')
    expect(page).toContain('summariseInventory(query, { heldAway: true })')
  })

  it('pins the location whatever the URL says', () => {
    // Sorting and paging still work; which stock the page may show does not
    // come from the query string.
    expect(page).toContain('locationId: [location.id],')
  })

  it('says why these watches were not on the stock list', () => {
    expect(page).toContain('{!location.isOnHand && (')
    expect(page).toContain('not on the main stock list')
  })

  it('is where the Locations card sends somebody who may open it', () => {
    // Otherwise "View stock →" on Hong Kong leads to an empty table: the card
    // saying nine watches and the list it points at showing none.
    const manager = readFileSync(join(process.cwd(), 'src/components/reference/LocationManager.tsx'), 'utf8')
    expect(manager).toContain('`/locations/${location.id}`')
    expect(manager).toContain('canManage')
  })
})
