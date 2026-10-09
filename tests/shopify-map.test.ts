import { describe, expect, it } from 'vitest'
import {
  descriptionHtmlFor, isManagedSku, planSync, priceFor, quantityFor, seoDescriptionFor,
  mediaFilesFor, seoIsOurs, seoTitleFor, skuFor, statusFor, titleFor, titleIsOurs,
  type SyncProduct, type SyncWatch,
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
  locationName: 'Dubai',
  locationType: 'STORE',
  estSaleGbp: 1020000,
  caseSizeMm: 41,
  caseMaterial: 'Steel and white gold',
  dial: null,
  bracelet: null,
  movement: null,
  waterResistanceM: null,
  condition: 'EXCELLENT',
  // FULL_SET, not the BOX_AND_PAPERS this fixture used to carry: that is not
  // one of the five values BoxPapers has, so every test reading it was reading
  // a watch that could not exist.
  boxPapers: 'FULL_SET',
  description: null,
  images: [],
  shopifyProductId: null,
  ...over,
})

const product = (over: Partial<SyncProduct> = {}): SyncProduct => ({
  id: 'gid://shopify/Product/1',
  sku: '1143',
  title: 'Datejust II Fluted 41',
  status: 'ACTIVE',
  seoTitle: null,
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
  it('leads with the family, never the brand', () => {
    // The card carries the brand above the title already.
    expect(titleFor(watch())).toBe('116334')
    expect(titleFor(watch({ model: '116610LV', nickname: 'Submariner Date', dial: 'Green', caseSizeMm: 41 })))
      .toBe('Submariner Date Green 41')
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
    expect(plan.update).toEqual([{
      watch: watch(), productId: 'gid://shopify/Product/1', title: 'Datejust II Fluted 41',
      seoTitle: null,
    }])
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
  it('names it in the shop’s own convention', () => {
    expect(titleFor(watch({ nickname: 'Explorer II', dial: 'Black', caseSizeMm: 42 })))
      .toBe('Explorer II Black 42')
  })

  it('gives it the specification, since there is no copy yet', () => {
    expect(descriptionHtmlFor(watch())).toContain('2023')
  })
})

/**
 * The title, in the shop's own convention.
 *
 * Their titles lead with the family and never with the brand — "Explorer II
 * Black 42" — because the card already carries the brand above the title. The
 * first version of this wrote "Rolex 116334 \"Datejust 41\"", which said the
 * brand twice on every card and, because the shop's menu falls back to the
 * title, made a brand menu of a hundred families of one.
 */
describe('naming a product', () => {
  it('leads with the family, then the dial, then the size', () => {
    expect(titleFor(watch({ nickname: 'Explorer II', dial: 'Black', caseSizeMm: 42 })))
      .toBe('Explorer II Black 42')
  })

  it('does not say the size twice', () => {
    // The nickname often carries it already.
    expect(titleFor(watch({ nickname: 'Datejust 41', dial: 'Wimbledon', caseSizeMm: 41 })))
      .toBe('Datejust Wimbledon 41')
  })

  it('never leads with the brand', () => {
    expect(titleFor(watch())).not.toMatch(/^Rolex/)
  })

  it('leaves a description out of the title', () => {
    // A dial name earns its place when it is a colour, not when it is a
    // sentence about the hour markers.
    expect(titleFor(watch({
      nickname: 'Datejust 41', dial: 'Champagne with Factory Diamond Hour Markers', caseSizeMm: 41,
    }))).toBe('Datejust 41')
  })

  it('falls back to the reference alone when there is no name', () => {
    // Not "116334 41", which reads like two references.
    expect(titleFor(watch({ nickname: null }))).toBe('116334')
  })
})

describe('whose title is it', () => {
  it('claims the ones this system wrote', () => {
    expect(titleIsOurs('Rolex 116334 "Datejust 41"', watch())).toBe(true)
  })

  it('leaves alone the ones somebody chose', () => {
    for (const title of [
      'Explorer II Black 42', 'Datejust Two-Tone Wimbledon 41', 'Lady-Datejust 26 Rolesor Fluted',
      'Cosmograph Daytona Yellow Gold 40', 'Sky Dweller Two Tone Champagne 42',
    ]) {
      expect(titleIsOurs(title, watch()), title).toBe(false)
    }
  })

  it('lets go once somebody has edited it into the shop’s convention', () => {
    // Which is exactly when this system should stop touching it.
    expect(titleIsOurs(titleFor(watch({ nickname: 'Explorer II' })), watch())).toBe(false)
  })
})

/**
 * What a search engine is shown.
 *
 * Every product page in the store had an empty search title and an empty
 * description, so Google fell back to the product title: "Datejust II Fluted
 * 41" — no maison, no reference, nothing to match what anybody types.
 */
describe('the search title', () => {
  it('leads with the maison and carries the reference', () => {
    expect(seoTitleFor(watch({ nickname: 'Datejust II' })))
      .toBe('Rolex Datejust II 116334 | One Street Watches')
  })

  it('works with no nickname at all', () => {
    expect(seoTitleFor(watch())).toBe('Rolex 116334 | One Street Watches')
  })

  it('says nothing twice', () => {
    // The nickname sometimes carries the brand, and the family sometimes
    // carries the size the reference already implies.
    expect(seoTitleFor(watch({ nickname: 'Rolex Submariner Date', model: '116610LV' })))
      .toBe('Rolex Submariner Date 116610LV | One Street Watches')
  })

  it('always ends with the shop, however long the piece is called', () => {
    const long = seoTitleFor(watch({
      brandName: 'Vacheron Constantin',
      nickname: 'Overseas Perpetual Calendar Ultra-Thin Skeleton',
      model: '4300V/120G-B946',
    }))
    expect(long.endsWith('| One Street Watches')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(65)
  })
})

describe('the search description', () => {
  it('reads as sentences about the actual watch', () => {
    expect(seoDescriptionFor(watch({ nickname: 'Datejust II', caseMaterial: 'Oystersteel' })))
      .toBe('2023 Rolex Datejust II 116334 in Oystersteel, 41mm. Excellent condition, '
        + 'with box and papers. Authenticated at our own bench and held in Dubai.')
  })

  it('does not say "Unworn condition"', () => {
    const text = seoDescriptionFor(watch({ condition: 'UNWORN' }))
    expect(text).toContain('Unworn, with box and papers.')
    expect(text).not.toContain('Unworn condition')
  })

  it('leaves out what is not recorded rather than saying it is unknown', () => {
    const text = seoDescriptionFor(watch({
      year: null, caseMaterial: null, caseSizeMm: null,
      condition: 'UNKNOWN', boxPapers: 'UNKNOWN', locationName: null,
    }))
    expect(text).toBe('Rolex 116334. Authenticated at our own bench.')
    expect(text).not.toMatch(/unknown|not recorded|null/i)
  })

  it('never runs past what a search result will show', () => {
    const text = seoDescriptionFor(watch({
      brandName: 'Vacheron Constantin',
      nickname: 'Overseas Perpetual Calendar Ultra-Thin Skeleton',
      model: '4300V/120G-B946',
      caseMaterial: 'Stainless Steel and 18k White Gold with a sapphire caseback',
      locationName: 'United Kingdom',
    }))
    expect(text.length).toBeLessThanOrEqual(155)
    // Stopped between sentences, never cut mid-word.
    expect(text.endsWith('.')).toBe(true)
  })

  it('leaves the price out, because it is the one fact that goes stale', () => {
    expect(seoDescriptionFor(watch())).not.toMatch(/\d{2,}[,.]\d|Dhs|£|\$/)
  })
})

/**
 * Whose search title is it.
 *
 * The same bargain the product title strikes: this system writes the ones
 * nobody has touched, and lets go the moment somebody writes their own.
 */
describe('whose search title is it', () => {
  it('claims an empty one, because there is nothing to protect', () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(seoIsOurs(value), String(value)).toBe(true)
    }
  })

  it('claims the ones this system wrote', () => {
    expect(seoIsOurs(seoTitleFor(watch()))).toBe(true)
  })

  it('leaves alone one somebody wrote themselves', () => {
    expect(seoIsOurs('Buy a pre-owned Rolex Datejust in Dubai')).toBe(false)
  })
})

/**
 * The photographs, which are the half of the mirror that never worked.
 *
 * Pictures were sent to Shopify exactly once, on the push that created the
 * product, and never again — so a photograph replaced here stayed the old one
 * on the shop for ever, which is precisely what was reported. The fix rests on
 * two facts about `productSet.files` worth stating in tests rather than in a
 * comment: the list given is the complete list, and a file is either an id the
 * shop already holds or a URL for it to come and fetch.
 */
const ORIGIN = 'https://inventory.example.com'

describe('a watch that is still travelling', () => {
  it('is a draft, not a live listing', () => {
    // The plates say "available to view today" and the shop is a room people
    // walk into. A piece in a courier's bag is not that, however complete.
    expect(statusFor(watch({ locationType: 'TRANSIT' }))).toBe('DRAFT')
  })

  it('publishes itself the moment it lands, with nothing else to do', () => {
    expect(statusFor(watch({ locationType: 'STORE' }))).toBe('ACTIVE')
    expect(statusFor(watch({ locationType: 'VAULT' }))).toBe('ACTIVE')
    // A location with no type recorded is not a reason to hide the watch.
    expect(statusFor(watch({ locationType: null }))).toBe('ACTIVE')
  })

  it('still archives one that has left the book', () => {
    // Transit does not outrank sold: a watch being couriered to its buyer is
    // gone, and its page should come down rather than go back to draft.
    expect(statusFor(watch({ status: 'SOLD', locationType: 'TRANSIT' }))).toBe('ARCHIVED')
  })

  it('has nothing to sell while it is in the air', () => {
    expect(quantityFor(watch({ locationType: 'TRANSIT' }))).toBe(0)
    expect(quantityFor(watch({ locationType: 'STORE' }))).toBe(1)
  })
})

describe('the photographs we send to the shop', () => {
  it('offers a photograph the shop has never seen as a URL to collect', () => {
    const files = mediaFilesFor(watch({ images: [{ id: 'img_1', mediaId: null }] }), ORIGIN)
    expect(files).toEqual([{
      originalSource: `${ORIGIN}/api/storefront-image/img_1`,
      contentType: 'IMAGE',
      alt: titleFor(watch()),
    }])
  })

  it('names one it already holds, rather than uploading it again', () => {
    // The whole point of recording the media id. Without this every sync
    // re-uploads every picture, for ever.
    const files = mediaFilesFor(
      watch({ images: [{ id: 'img_1', mediaId: 'gid://shopify/MediaImage/1' }] }),
      ORIGIN,
    )
    expect(files).toEqual([{ id: 'gid://shopify/MediaImage/1' }])
  })

  it('keeps the order they are arranged in here', () => {
    // `files` is also the order they appear on the product page, so the
    // photograph chosen as the first one here is the one the shop leads with.
    const files = mediaFilesFor(watch({
      images: [
        { id: 'img_1', mediaId: 'gid://m/1' },
        { id: 'img_2', mediaId: null },
        { id: 'img_3', mediaId: 'gid://m/3' },
      ],
    }), ORIGIN)
    expect(files).toEqual([
      { id: 'gid://m/1' },
      {
        originalSource: `${ORIGIN}/api/storefront-image/img_2`,
        contentType: 'IMAGE',
        alt: titleFor(watch()),
      },
      { id: 'gid://m/3' },
    ])
  })

  it('says nothing at all about a watch we have not photographed', () => {
    // Not an empty list. An empty list is an instruction to strip the page,
    // and the pictures on the shop today were put there by hand.
    expect(mediaFilesFor(watch({ images: [] }), ORIGIN)).toBeNull()
  })

  it('says nothing when it does not know its own address', () => {
    // Shopify fetches the bytes, so a relative URL is useless to it.
    expect(mediaFilesFor(watch({ images: [{ id: 'img_1', mediaId: null }] }), null)).toBeNull()
  })

  it('does not offer an upload for a watch that has left the book', () => {
    // The storefront door only opens for stock still held, so the URL would
    // answer 404 and the shop would record a failed media row.
    const sold = watch({ status: 'SOLD', images: [{ id: 'img_1', mediaId: null }] })
    expect(statusFor(sold)).toBe('ARCHIVED')
    expect(mediaFilesFor(sold, ORIGIN)).toBeNull()
  })

  it('still keeps the pictures on a page it is archiving', () => {
    // Archived, not stripped: the page can be brought back, and everything
    // the shop already holds is named by id, which needs no fetching.
    const sold = watch({ status: 'SOLD', images: [{ id: 'img_1', mediaId: 'gid://m/1' }] })
    expect(mediaFilesFor(sold, ORIGIN)).toEqual([{ id: 'gid://m/1' }])
  })
})
