import { describe, expect, it } from 'vitest'
import {
  descriptionHtmlFor, isManagedSku, planSync, priceFor, quantityFor, skuFor, statusFor,
  titleFor, type SyncProduct, type SyncWatch,
} from '@/lib/shopify-map'
import type { RateTable } from '@/lib/currency'

// Rates are held scaled by 10,000, so 3.6725 dirhams to the dollar is 36,725.
const RATES: RateTable = { AED: 36_725, GBP: 7_900, EUR: 9_200 }

const watch = (over: Partial<SyncWatch> = {}): SyncWatch => ({
  id: 'wch_1',
  stockNo: 1143,
  brandName: 'Rolex',
  model: '116334',
  serial: '0SQ84951',
  nickname: null,
  year: 2023,
  status: 'IN_STOCK',
  estSaleGbp: 1020000,
  caseSizeMm: 41,
  caseMaterial: 'Steel and white gold',
  dial: null,
  bracelet: null,
  movement: null,
  waterResistanceM: null,
  condition: 'EXCELLENT',
  boxPapers: 'BOX_AND_PAPERS',
  description: null,
  imageIds: [],
  shopifyProductId: null,
  ...over,
})

const product = (over: Partial<SyncProduct> = {}): SyncProduct => ({
  id: 'gid://shopify/Product/1',
  sku: '1143',
  title: 'Datejust II Fluted 41',
  status: 'ACTIVE',
  ...over,
})

/**
 * The SKU is the join, and it was already in the data.
 *
 * The store used stock numbers as SKUs before any of this was built, which is
 * the only reason the two systems can be lined up without somebody matching
 * thirty products by hand.
 */
describe('recognising our own products', () => {
  it('claims a stock number', () => {
    expect(isManagedSku('1143')).toBe(true)
    expect(isManagedSku(' 1143 ')).toBe(true)
    expect(skuFor(1143)).toBe('1143')
  })

  it('disclaims anything else', () => {
    // These are real values from the store: five placeholders and three
    // products somebody never gave a SKU.
    for (const sku of ['DUMMY-RM011', 'DUMMY-PP5711', '', null, undefined, 'RX-1143']) {
      expect(isManagedSku(sku), String(sku)).toBe(false)
    }
  })
})

describe('what a watch looks like on the storefront', () => {
  it('is live once it is held and priced', () => {
    expect(statusFor(watch())).toBe('ACTIVE')
    expect(quantityFor(watch())).toBe(1)
  })

  it('is a draft while it has no price', () => {
    // The alternative is a page showing zero, or a number somebody invented to
    // get past the field.
    expect(statusFor(watch({ estSaleGbp: null }))).toBe('DRAFT')
    expect(statusFor(watch({ estSaleGbp: 0 }))).toBe('DRAFT')
  })

  it('stays up but unbuyable once it is spoken for', () => {
    for (const status of ['RESERVED', 'SALE_AGREED']) {
      expect(statusFor(watch({ status })), status).toBe('ACTIVE')
      expect(quantityFor(watch({ status })), status).toBe(0)
    }
  })

  it('goes away when it is sold, returned or written off', () => {
    for (const status of ['SOLD', 'RETURNED', 'WRITTEN_OFF']) {
      expect(statusFor(watch({ status })), status).toBe('ARCHIVED')
    }
  })
})

describe('the price', () => {
  it('converts the base figure into the store’s own currency', () => {
    // $10,200 held as minor units, quoted in a store that trades in dirhams.
    expect(priceFor(1020000, 'AED', RATES)).toBe('37459.50')
  })

  it('is absent rather than zero when nothing is set', () => {
    expect(priceFor(null, 'AED', RATES)).toBeNull()
    expect(priceFor(0, 'AED', RATES)).toBeNull()
  })
})

describe('the page’s words', () => {
  it('leads with what somebody searches by', () => {
    expect(titleFor(watch())).toBe('Rolex 116334')
    expect(titleFor(watch({ model: '116610LV', nickname: 'Hulk' })))
      .toBe('Rolex 116610LV "Hulk"')
  })

  it('leaves out what is not known rather than saying "unknown"', () => {
    const html = descriptionHtmlFor(watch())
    expect(html).toContain('<th align="left">Year</th><td>2023</td>')
    expect(html).toContain('41mm')
    expect(html).not.toContain('Dial')
    expect(html).not.toContain('unknown')
  })

  it('escapes what somebody typed, because it is going into a page', () => {
    const html = descriptionHtmlFor(watch({ description: 'Serviced <by> "us" & kept' }))
    expect(html).toContain('&lt;by&gt;')
    expect(html).toContain('&quot;us&quot;')
    expect(html).toContain('&amp;')
    expect(html).not.toContain('<by>')
  })
})

/**
 * The plan.
 *
 * Every irreversible thing this integration can do is decided here, in a pure
 * function, so it can be read before it is run. `remove` deletes somebody's
 * live product page; it had better be right.
 */
describe('planning the sync', () => {
  it('creates a product for stock that has none', () => {
    const plan = planSync([watch({ stockNo: 1400 })], [])
    expect(plan.create.map((w) => w.stockNo)).toEqual([1400])
    expect(plan.remove).toEqual([])
  })

  it('updates the product whose SKU matches', () => {
    const plan = planSync([watch()], [product()])
    expect(plan.update).toEqual([{ watch: watch(), productId: 'gid://shopify/Product/1' }])
    expect(plan.create).toEqual([])
    expect(plan.remove).toEqual([])
  })

  it('removes a product that answers to no watch', () => {
    // The five DUMMY placeholders and the three with no SKU at all.
    const plan = planSync([], [
      product({ id: 'p1', sku: 'DUMMY-RM011', title: 'RM 011' }),
      product({ id: 'p2', sku: null, title: 'GMT-Master II Pepsi 40' }),
    ])
    expect(plan.remove.map((r) => r.productId).sort()).toEqual(['p1', 'p2'])
    expect(plan.archive).toEqual([])
  })

  it('removes the second page for a stock number and keeps the first', () => {
    // Both of these are live in the store today at two different prices. Two
    // pages for one watch is how it gets promised to two people.
    const plan = planSync([watch({ stockNo: 1256 })], [
      product({ id: 'first', sku: '1256' }),
      product({ id: 'second', sku: '1256' }),
    ])
    expect(plan.update.map((u) => u.productId)).toEqual(['first'])
    expect(plan.remove.map((r) => r.productId)).toEqual(['second'])
  })

  it('archives a product whose watch has left the book, rather than deleting it', () => {
    // The likeliest reason is a sale somebody tidied away. Archiving is
    // reversible; a deleted page is not.
    const plan = planSync([], [product({ id: 'p9', sku: '1143' })])
    expect(plan.archive.map((a) => a.productId)).toEqual(['p9'])
    expect(plan.remove).toEqual([])
  })

  it('never removes a product for stock we still hold', () => {
    const plan = planSync([watch()], [product()])
    expect(plan.remove).toEqual([])
    expect(plan.archive).toEqual([])
  })

  it('does not create a page for a watch that is already sold', () => {
    const plan = planSync([watch({ status: 'SOLD' })], [])
    expect(plan.create).toEqual([])
  })

  it('still updates a sold watch that has a page, so the page can be archived', () => {
    const plan = planSync([watch({ status: 'SOLD' })], [product()])
    expect(plan.update).toHaveLength(1)
    expect(statusFor(plan.update[0]!.watch)).toBe('ARCHIVED')
  })
})

/**
 * What the sync owns, and what it leaves alone.
 *
 * The store's product pages are editorial: "Datejust II Fluted 41" is a better
 * title than "Rolex 116334", and the paragraph under it was written to sell the
 * watch. Neither is a fact this system holds a better version of. A mirror that
 * overwrote them on every price change would quietly undo the shop's own work,
 * which is the surest way to get itself switched off.
 *
 * These assertions are about the seed values only — what a page is given when
 * it is first created, and nobody has written anything yet.
 */
describe('seeding a page that does not exist yet', () => {
  it('names it well enough to be found and then improved', () => {
    expect(titleFor(watch())).toBe('Rolex 116334')
  })

  it('gives it the specification, since there is no copy yet', () => {
    expect(descriptionHtmlFor(watch())).toContain('2023')
  })
})
