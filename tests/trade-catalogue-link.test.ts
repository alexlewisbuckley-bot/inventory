import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

/**
 * The same file with its prose taken out.
 *
 * Every "must not appear" assertion below needs this. These files explain
 * at length why they do *not* use the storefront switch and why the action
 * is *not* behind `catalogue:read` — so a test that greps the raw text for
 * those names matches the very comment that promises they are absent, and
 * fails on a file that is correct. Asserting against the code alone is the
 * only way the assertion means what it says.
 */
const codeOf = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const service = read('src/server/services/catalogue-link-service.ts')
const room = read('src/components/trade/TradeRoom.tsx')
const page = read('src/app/c/[token]/page.tsx')
const imageRoute = read('src/app/c/[token]/image/[id]/route.ts')
const migration = read('src/server/db/migrations/0055_a_catalogue_for_traders.sql')
const actions = read('src/app/actions/catalogue-links.ts')

/**
 * A list we can hand a dealer.
 *
 * Alex: "Create a catalogue link that shows all the watches except in
 * transit & hong kong to show traders what we have with filtering and no
 * pricing."
 *
 * Four requirements, and each is enforced somewhere different: the
 * exclusions in the service's predicate, "all the watches" by the absence
 * of a clause the reseller trade room has, the filtering in a component
 * that already had it, and "no pricing" by a boundary type with no price
 * on it.
 *
 * The behaviour was run against a real database and a real browser: 21 of
 * 26 watches listed with Hong Kong and transit held back, a photograph
 * served from the link's own route and a warranty card 404ing on the same
 * route, the page carrying no price anywhere, and a revoked link returning
 * nothing. What is kept here is everything provable without either.
 */

describe('what the link shows', () => {
  it('leaves out a place we would rather not offer the trade', () => {
    // The whole point of the feature's one new column. Transit was already
    // excluded from everything outward-facing; Hong Kong is the case that
    // needed a switch of its own.
    expect(service).toMatch(/function tradeable\(\)/)
    expect(service).toMatch(/eq\(locations\.showInTradeCatalogue, true\)/)
  })

  it('does not reuse the storefront switch to do it', () => {
    /*
     * The two questions have different answers and Hong Kong is the proof:
     * that stock is real stock the website may well sell, and sharing one
     * switch would have meant pulling it off onestreetwatches.com as the
     * price of pulling it off the dealer list.
     */
    expect(codeOf(service)).not.toMatch(/publishToStorefront/)
    // And not by location type either, which is the mistake migration 0036
    // was written to undo: a rule only one person knows, that nobody can
    // change without a deploy.
    expect(codeOf(service)).not.toMatch(/locations\.type/)
  })

  it('is stock we could actually sell today', () => {
    const predicate = service.slice(service.indexOf('function tradeable()'))
    expect(predicate.slice(0, 400)).toMatch(/eq\(watches\.status, 'IN_STOCK'\)/)
    expect(predicate.slice(0, 400)).toMatch(/isNull\(watches\.deletedAt\)/)
  })

  it('states the rule once, for the list, the count and the image door', () => {
    // A page that lists a watch whose photograph then 404s is worse than
    // either mistake on its own.
    expect(service.match(/tradeable\(\)/g)?.length).toBe(4) // 3 uses + the definition
    expect(service.match(/innerJoin\(locations/g)?.length).toBe(3)
  })

  it('lists a watch nobody has photographed yet', () => {
    /*
     * "All the watches." The reseller trade room requires a picture, which
     * quietly sets its membership — a piece bought this morning and not yet
     * shot is simply absent from it. Right for a reseller's own shop and
     * wrong here: a dealer hunting a reference wants to know we have one
     * before they want to see it.
     */
    const query = service.slice(service.indexOf('export async function getHouseCatalogue'))
    expect(query.slice(0, 3000)).not.toMatch(/EXISTS \(\s*SELECT 1 FROM watch_images/)
  })
})

describe('no money crosses the boundary', () => {
  it('has no price on the type the page is handed', () => {
    // Not hidden by the component — there is no field to hide. The next
    // person to add one to TradeItem has to notice, and this fails if they
    // do not.
    const shape = room.slice(room.indexOf('export interface TradeItem'))
    const fields = shape.slice(0, shape.indexOf('}'))
    expect(fields).not.toMatch(/price|cost|retail|margin|Gbp|trade:/i)
  })

  it('never names a money column in the query', () => {
    // A page cannot leak a number its query never asked for.
    expect(codeOf(service)).not.toMatch(/tradePriceGbp|estSaleGbp|purchasePriceGbp|askingPrice/)
  })

  it('offers no filter that asks about price', () => {
    // The questions a dealer asks, and not one about money.
    expect(room).not.toMatch(/label: '(Budget|Price|Retail|Cost)'/)
  })
})

describe('the door', () => {
  it('is nothing once it is revoked', () => {
    const door = service.slice(service.indexOf('export async function getCatalogueDoor'))
    const body = door.slice(0, door.indexOf('export async function getHouseCatalogue'))
    expect(body).toMatch(/eq\(catalogueLinks\.isActive, true\)/)
    expect(body).toMatch(/isNull\(catalogueLinks\.revokedAt\)/)
  })

  it('refuses a string too short to be a token before it reaches the database', () => {
    // So a scan cannot use this as an index probe.
    expect(service).toMatch(/if \(!token \|\| token\.length < 16\) return null/)
  })

  it('is kept rather than deleted when it is withdrawn', () => {
    // "Which link did we send the Dubai group, and is it still live" is a
    // question asked months later. A row that is gone cannot answer it.
    const revoke = service.slice(service.indexOf('export async function revokeCatalogueLink'))
    expect(revoke).toMatch(/isActive: false, revokedAt: new Date\(\)/)
    expect(revoke).not.toMatch(/\.delete\(/)
  })

  it('is minted with as much entropy as a shop window', () => {
    expect(service).toMatch(/randomBytes\(24\)\.toString\('base64url'\)/)
  })

  it('is issued and withdrawn only by somebody who may show outsiders our stock', () => {
    /*
     * `reseller:manage`, not `catalogue:read`. A trader signed in to the
     * application holds the latter, and it would let them mint the link
     * that shows our whole book to anybody they liked.
     */
    expect(actions.match(/requireCapability\('reseller:manage'\)/g)?.length).toBe(2)
    expect(codeOf(actions)).not.toMatch(/catalogue:read/)
  })
})

describe('the photographs', () => {
  it('serves only the kinds this room is for', () => {
    // A warranty card is a serial, a date and a dealer's stamp, and it must
    // not be reachable by guessing at the route with an id from elsewhere.
    expect(service).toMatch(/inArray\(watchImages\.kind, kinds\)/)
    expect(service).toMatch(/door\.showTradePhotos \? \['WATCH', 'TRADE'\] : \['WATCH'\]/)
  })

  it('applies the availability predicate to the door, not just the listing', () => {
    const door = service.slice(service.indexOf('export async function getCatalogueImage'))
    expect(door.slice(0, 1400)).toMatch(/\.\.\.tradeable\(\)/)
    expect(door.slice(0, 1400)).toMatch(/innerJoin\(locations/)
  })

  it('withholds the trade shots in the query, not in the component', () => {
    /*
     * A link with no passphrase on it may be forwarded anywhere, and a
     * trade shot is a record picture often taken with the papers in frame.
     * Hiding the button would have left the pictures a URL away, so the
     * switch holds in both the listing and the door.
     */
    const query = service.slice(service.indexOf('export async function getHouseCatalogue'))
    expect(query.slice(0, 3000)).toMatch(/door\.showTradePhotos\s*\n?\s*\? sql/)
    expect(query.slice(0, 3000)).toMatch(/: sql<string\[\] \| null>`ARRAY\[\]::text\[\]`/)
  })
})

describe('the page a dealer opens', () => {
  it('is live, and never cached', () => {
    // A list that is a few minutes stale is a dealer ringing about a watch
    // that went this morning.
    expect(page).toMatch(/export const dynamic = 'force-dynamic'/)
    expect(page).toMatch(/export const revalidate = 0/)
  })

  it('says nothing to a search engine, or to a forwarded preview', () => {
    expect(page).toMatch(/robots: \{ index: false, follow: false, nocache: true \}/)
    // The tab says "Trade catalogue" and not how much stock is behind it:
    // a preview reading "94 watches" has told the forwarding half of the
    // story to somebody never given the other half.
    expect(page).toMatch(/title: 'Trade catalogue'/)
  })

  it('is the same nothing as a link that never existed, when it is dead', () => {
    expect(page).toMatch(/if \(!catalogue\) notFound\(\)/)
  })

  it('offers no way to sign out of a door with no passphrase', () => {
    // A control that cannot do what it says.
    expect(page).toMatch(/signOut=\{false\}/)
    expect(room).toMatch(/signOut && \(/)
  })

  it('never asks a shared cache to hold a photograph', () => {
    // The URL carries the token, and a proxy holding these would outlive a
    // revoked link.
    expect(imageRoute).toMatch(/'Cache-Control': 'private, max-age=3600'/)
    expect(imageRoute).toMatch(/'X-Robots-Tag': 'noindex, nofollow'/)
  })
})

describe('a watch with no photograph', () => {
  it('does not take the page down with it', () => {
    /*
     * The reseller room requires a picture to be listed at all, so the tile
     * reached straight into `gallery(item)[0].id` and was right to. This
     * list has no such requirement, and reading `.id` off nothing would
     * take out the whole grid rather than the one tile.
     */
    expect(room).not.toMatch(/gallery\(item\)\[0\]\.id/)
    expect(room).toMatch(/const shots = gallery\(item\)/)
    expect(room).toMatch(/\$\{base\}\/image\/\$\{shots\[0\]!\.id\}/)
  })

  it('says so, rather than showing an empty square', () => {
    // A blank plate reads as a page that failed to load.
    expect(room).toMatch(/Photograph to follow/)
  })

  it('is not a button that opens an empty viewer', () => {
    expect(room).toMatch(/\{shots\.length > 0 \? \(/)
  })
})

describe('the two rooms do not leak into each other', () => {
  it('builds every URL from the door it was opened through', () => {
    // The token says nothing about which door it came through. A room that
    // guessed would draw every photograph from the wrong one.
    expect(room).toMatch(/const base = basePath \?\? `\/t\/\$\{token\}`/)
    expect(room).not.toMatch(/`\/t\/\$\{token\}\/image/)
    expect(page).toMatch(/basePath=\{`\/c\/\$\{params\.token\}`\}/)
  })

  it('does not hand a dealer any token but the one they came in on', () => {
    expect(codeOf(room)).not.toMatch(/publicToken|tradeToken/)
  })
})

describe('the migration', () => {
  it('takes Hong Kong off the list without taking it off the website', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS show_in_trade_catalogue BOOLEAN NOT NULL DEFAULT TRUE/)
    expect(migration).toMatch(/UPDATE locations SET show_in_trade_catalogue = FALSE\s*\nWHERE name ILIKE '%hong kong%'/)
    // Only the new column is written. The storefront switch is not touched.
    expect(codeOf(migration.replace(/^--[^\n]*/gm, ''))).not.toMatch(/SET publish_to_storefront/)
  })

  it('takes transit off it too', () => {
    expect(migration).toMatch(/UPDATE locations SET show_in_trade_catalogue = FALSE WHERE type = 'TRANSIT'/)
  })

  it('leaves every other place on it', () => {
    // A column arriving should not quietly empty a list — the same default
    // publish_to_storefront took, for the same reason.
    expect(migration).toMatch(/DEFAULT TRUE/)
  })
})
