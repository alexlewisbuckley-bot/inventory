import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const catalogue = readFileSync('src/server/services/catalogue-service.ts', 'utf8')
const reseller = readFileSync('src/server/services/reseller-service.ts', 'utf8')

/**
 * A watch in a courier's bag is not stock a dealer can be offered.
 *
 * "In transit" is not a status — it is a location, and a watch being
 * carried between them stays IN_STOCK the whole way. Every outward-facing
 * list filtered on status alone, so all of them offered pieces that were
 * not in the building: the trade catalogue, the reseller shop window, the
 * trade room, and the image and enquiry doors behind them.
 *
 * The rule is the location's own publishToStorefront switch, which is what
 * the Shopify sync already reads. Not a test on location type: transit is
 * only the case that got noticed, and a bonded warehouse or a piece away
 * at service asks exactly the same question — the reasoning is recorded on
 * sellableFrom() in shopify-map, and this follows it rather than inventing
 * a second rule that would drift away from it.
 */
describe('the trade catalogue offers only what we hold', () => {
  it('reads the location switch, not the location type', () => {
    expect(catalogue).toMatch(/eq\(locations\.publishToStorefront, true\)/)
    // No comparison against locations.type anywhere — the prose explains
    // why transit is not the rule, the code must not encode it as one.
    expect(catalogue).not.toMatch(/locations\.type/)
    expect(reseller).not.toMatch(/locations\.type/)
  })

  it('states the rule once, for the page, the count and the brand filter', () => {
    expect(catalogue).toMatch(/function offerable\(\)/)
    // Three reads, and a filter offering a brand the list will not then
    // show is worse than either fault alone.
    expect(catalogue.match(/offerable\(\)/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('joins the location everywhere it reads it', () => {
    const joins = catalogue.match(/innerJoin\(locations/g)?.length ?? 0
    const reads = catalogue.match(/\.where\(and\(\.\.\.offerable\(\)\)\)|\.where\(where\)/g)?.length ?? 0
    expect(joins).toBeGreaterThanOrEqual(reads)
  })
})

describe('a reseller is offered only what we hold', () => {
  it('shares one predicate across every door', () => {
    expect(reseller).toMatch(/function onOffer\(\)/)
    expect(reseller).toMatch(/eq\(locations\.publishToStorefront, true\)/)
  })

  it('covers all six reads', () => {
    // The count, the shop window, the trade room, the two image doors and
    // the enquiry door.
    expect(reseller.match(/onOffer\(\)/g)?.length).toBe(7) // 6 uses + the definition
  })

  it('joins the location in every one of them', () => {
    // Without the join the SQL names a table that is not in the FROM list
    // and the query fails at runtime — which a type check cannot see.
    expect(reseller.match(/innerJoin\(locations/g)?.length).toBe(6)
  })

  it('guards the image and enquiry doors too, not just the listings', () => {
    // Those are reachable with any id at all. A watch that has left the
    // listing should not still serve its photograph or take an enquiry.
    const imageDoors = reseller.match(/eq\(watchImages\.kind, '(WATCH|TRADE)'\),\n\s+\.\.\.onOffer\(\)/g)
    expect(imageDoors?.length).toBe(2)
    expect(reseller).toMatch(/eq\(watches\.id, watchId\), \.\.\.onOffer\(\)/)
  })

  it('no longer filters on status alone anywhere', () => {
    expect(reseller).not.toMatch(/eq\(watches\.status, 'IN_STOCK'\), isNull\(watches\.deletedAt\)\)\)/)
  })
})

const groupPost = readFileSync('src/server/services/group-post-service.ts', 'utf8')
const groupLib = readFileSync('src/lib/group-post.ts', 'utf8')
const enquiry = readFileSync('src/server/services/trade-enquiry-service.ts', 'utf8')

/**
 * The dealer group is a trade list too.
 *
 * The batch builder already refused to post a sold watch, an unpriced one
 * or one with no photograph — "a watch is left out rather than posted
 * badly". It had no opinion about where the watch was, so a piece in a
 * courier's bag went out at a trade price, which is worse than posting a
 * sold one: the dealer says yes and then is waited on.
 */
describe('the WhatsApp dealer group', () => {
  it('leaves out a watch that is not in the building', () => {
    expect(groupPost).toMatch(/if \(!row\.here\) \{/)
    expect(groupPost).toMatch(/reason: 'not-here'/)
    expect(groupPost).toMatch(/here: locations\.publishToStorefront/)
    expect(groupPost).toMatch(/innerJoin\(locations/)
  })

  it('says so, rather than dropping it silently', () => {
    // Every other omission is reported back with its reason; this one is
    // worded as where the watch is, because that is what the sender acts on.
    expect(groupLib).toMatch(/'not-here': 'in transit'/)
    expect(groupLib).toMatch(/SkipReason = 'sold' \| 'no-photo' \| 'no-price' \| 'not-here'/)
  })

  it('counts it in the summary line like any other skip', () => {
    // describeSkips reads SKIP_LABELS, so a new reason needs no new code
    // there — this pins that it is still driven off the one map.
    expect(groupLib).toMatch(/const reason = SKIP_LABELS\[skip\.reason\]/)
  })
})

describe('the trade enquiry door', () => {
  it('refuses a watch the catalogue is no longer offering', () => {
    // Reachable with any watch id, so it decides for itself rather than
    // trusting the page that called it.
    const fn = enquiry.slice(enquiry.indexOf('export async function raiseEnquiry'))
    expect(fn.slice(0, 1800)).toMatch(/eq\(locations\.publishToStorefront, true\)/)
    expect(fn.slice(0, 1800)).toMatch(/eq\(watches\.status, 'IN_STOCK'\)/)
  })
})
