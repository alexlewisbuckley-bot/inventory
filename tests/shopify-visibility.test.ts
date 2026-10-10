import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planSync, type SyncProduct, type SyncWatch } from '@/lib/shopify-map'

/**
 * Live in the admin, and nowhere else.
 *
 * A Patek was pushed, written, priced, photographed and reported as synced,
 * and was not on the website. Nine others were in the same state and had been
 * for a day. Nothing was wrong with any of them: Shopify had simply not put
 * them in its own shop window, and attaching a product to a sales channel is a
 * separate act from creating it.
 *
 * Two faults, one cause. The sync asked which sales channels it could see and
 * read an empty list as "this shop has no Online Store" rather than as "this
 * app has not been told about it", so it published nothing and said nothing.
 * And the plan read a product's STATUS and never its VISIBILITY, so there was
 * no reading anywhere — not in the sync, not on the page somebody opens to ask
 * this exact question — that could tell the difference between a watch that
 * was never pushed and one that was pushed into a locked room.
 *
 * Status is a thing this system decides. Visibility is a thing the shop
 * decides. Anything that checks only the first is checking the easy half.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

const watch = (over: Partial<SyncWatch> = {}): SyncWatch => ({
  id: 'w1', stockNo: 1520, brandName: 'Patek Philippe', model: 'Nautilus',
  nickname: null, reference: '5740/1G-001', serial: null, year: 2023,
  status: 'IN_STOCK', locationPublishes: true, estSaleGbp: 928850,
  caseSizeMm: 40, caseMaterial: null, dial: null, bracelet: null,
  movement: null, waterResistanceM: null, condition: 'EXCELLENT',
  boxPapers: 'FULL_SET', description: null, images: [], shopifyProductId: null,
  ...over,
}) as SyncWatch

const product = (over: Partial<SyncProduct> = {}): SyncProduct => ({
  id: 'gid://shopify/Product/10353276485887',
  sku: '1520', title: 'Nautilus', status: 'ACTIVE',
  publishedAt: '2026-10-04T15:03:37Z', seoTitle: null,
  ...over,
})

describe('a page nobody can see', () => {
  it('is noticed, where a page that is merely wrong would be', () => {
    const plan = planSync([watch()], [product({ publishedAt: null })])
    expect(plan.publish).toEqual([{
      productId: 'gid://shopify/Product/10353276485887', sku: '1520', title: 'Nautilus',
    }])
    // And it is still an update: the watch's own fields are pushed as usual.
    expect(plan.update).toHaveLength(1)
  })

  it('is not raised about a product already in the window', () => {
    expect(planSync([watch()], [product()]).publish).toEqual([])
  })

  it('is not raised about stock we do not mean to sell', () => {
    // Two different reasons a watch is correctly off the site, both of which
    // would otherwise read as this fault and send somebody looking for a bug.
    const travelling = planSync([watch({ locationPublishes: false })], [product({ publishedAt: null })])
    expect(travelling.publish).toEqual([])
    const sold = planSync([watch({ status: 'SOLD' })], [product({ publishedAt: null })])
    expect(sold.publish).toEqual([])
    // An unpriced watch goes up as a draft, and a draft is meant to be unseen.
    const unpriced = planSync([watch({ estSaleGbp: null })], [product({ publishedAt: null })])
    expect(unpriced.publish).toEqual([])
  })

  it('is read from the shop, not from our own record of the push', () => {
    // The whole difficulty: every record on this side said the watch was
    // listed and synced, and every one of them was right.
    const service = read('src/server/services/shopify-service.ts')
    expect(service).toMatch(/id title status publishedAt/)
    expect(service).toMatch(/publishedAt: edge\.node\.publishedAt \?\? null/)
  })
})

describe('being refused a sales channel', () => {
  it('is never read as the shop not having one', () => {
    // `publications` returns the channels this app may see. Without the scope
    // that is an empty list rather than an error, and the empty list was being
    // believed — so the sync skipped publishing and reported success.
    const service = read('src/server/services/shopify-service.ts')
    expect(service).toMatch(/seen\.length === 0/)
    expect(service).toMatch(/read_publications and write_publications permissions/)
    // And the page says it outright, without waiting for a push to catch it.
    expect(service).toMatch(/async function channelHealth/)
    expect(read('src/components/settings/StorefrontSync.tsx'))
      .toMatch(/The shop will not let this app publish anything/)
    // The silent return that let it happen: no publication, no complaint.
    expect(service).not.toMatch(/if \(!publicationId\) return null/)
  })

  it('stops being refused the moment the scope is granted', () => {
    // The token carries the scopes it was minted with and lasts a day, and the
    // refusal is remembered for the life of the instance. So the obvious move
    // after granting a permission — press Apply again — went on using the
    // credentials from before the change, and granting it looked like it had
    // not worked. A run re-asks; a later batch of the same run does not.
    const service = read('src/server/services/shopify-service.ts')
    expect(service).toMatch(/export function forgetCredentials\(\): void \{\n  cachedToken = null\n  cachedPublication = null/)
    expect(service).toMatch(/if \(after === null\) forgetCredentials\(\)/)
  })

  it('is said once rather than once per watch', () => {
    // A missing permission is one line of setup that fails every watch
    // identically; a hundred and thirty-one copies of it buries the failure
    // that is really a watch's own problem.
    const service = read('src/server/services/shopify-service.ts')
    expect(service).toMatch(/cachedPublication/)
    expect(service).toMatch(/refused\.add\(warning\)/)
  })
})

describe('the page somebody opens to ask why', () => {
  it('shows what the shop is hiding, not only what we withheld', () => {
    const service = read('src/server/services/shopify-service.ts')
    expect(service).toMatch(/invisibleProducts\(\)/)
    // A reading from somebody else's API, which must not take the page down.
    const body = service.slice(service.indexOf('async function invisibleProducts'))
    expect(body.slice(0, 600)).toMatch(/catch/)

    const panel = read('src/components/settings/StorefrontSync.tsx')
    expect(panel).toMatch(/health\.invisible\.length > 0/)
    expect(panel).toMatch(/read_publications/)
  })

  it('counts a page put back in the window as its own kind of success', () => {
    // Otherwise the run that fixed ten invisible watches and changed nothing
    // else reports "0 updated", which is exactly wrong about what it did.
    const service = read('src/server/services/shopify-service.ts')
    expect(service).toMatch(/published: number/)
    expect(service).toMatch(/outcome\.published \+= 1/)
  })
})
