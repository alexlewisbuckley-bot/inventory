import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  fingerprintFor, planSync, type SyncProduct, type SyncWatch,
} from '@/lib/shopify-map'
import { creatableName, isCreatable, CREATABLE_TYPES } from '@/lib/shopify-metafields'

/**
 * The plan used to count pages, not differences.
 *
 * Every watch with a product went on the update list, so the screen read
 * "143 to update" before a push and "143 to update" after one, and Apply
 * re-sent the whole catalogue every time. These tests hold the line that a
 * push which changed nothing leaves nothing to do.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

const watch = (over: Partial<SyncWatch> = {}): SyncWatch => ({
  id: 'wch_1',
  stockNo: 1143,
  brandName: 'Rolex',
  model: '116334',
  serial: '0SQ84951',
  modelName: null,
  year: 2023,
  status: 'IN_STOCK',
  locationName: 'Dubai',
  locationPublishes: true,
  estSaleGbp: 1020000,
  caseSizeMm: 41,
  caseMaterial: 'Steel and white gold',
  dial: null,
  bracelet: null,
  movement: null,
  waterResistanceM: null,
  condition: 'EXCELLENT',
  boxPapers: 'FULL_SET',
  description: null,
  images: [],
  shopifyProductId: null,
  shopifyFingerprint: null,
  ...over,
})

const product = (over: Partial<SyncProduct> = {}): SyncProduct => ({
  id: 'gid://shopify/Product/1',
  sku: '1143',
  title: 'Datejust II Fluted 41',
  status: 'ACTIVE',
  seoTitle: null,
  publishedAt: '2026-01-01T00:00:00Z',
  ...over,
})

/** What the plan would compute, as the service computes it. */
const print = (w: SyncWatch) => fingerprintFor(w, '42000.00', ['dial=gid://1'])

describe('the fingerprint', () => {
  it('is the same string for the same watch, twice', () => {
    expect(print(watch())).toBe(print(watch()))
  })

  it('moves when the price does', () => {
    expect(fingerprintFor(watch(), '42000.00', []))
      .not.toBe(fingerprintFor(watch(), '43000.00', []))
  })

  it('moves when a structured field does', () => {
    expect(fingerprintFor(watch(), '1', ['dial=gid://1']))
      .not.toBe(fingerprintFor(watch(), '1', ['dial=gid://2']))
  })

  it('does not move when the same fields arrive in a different order', () => {
    // The resolver walks a list; the order it happens to produce is not a
    // change to the shop and must not read as one.
    expect(fingerprintFor(watch(), '1', ['dial=a', 'material=b']))
      .toBe(fingerprintFor(watch(), '1', ['material=b', 'dial=a']))
  })

  it('moves when a photograph is replaced', () => {
    const before = watch({ images: [{ id: 'img_1', mediaId: 'gid://m/1' }] })
    const after = watch({ images: [{ id: 'img_2', mediaId: 'gid://m/2' }] })
    expect(print(before)).not.toBe(print(after))
  })

  it('moves when the watch sells', () => {
    // Status and quantity both turn over, and the page has to come down.
    expect(print(watch())).not.toBe(print(watch({ status: 'SOLD' })))
  })

  it('does not move for something the shop never sees', () => {
    // A cost price or a private note changes the record and changes nothing
    // about the page. Re-pushing for it is the waste this exists to stop.
    expect(print(watch())).toBe(print(watch({ shopifyProductId: 'gid://shopify/Product/9' })))
  })
})

describe('what the plan offers to update', () => {
  it('leaves alone a watch whose page already says the same thing', () => {
    const settled = watch({ shopifyFingerprint: print(watch()) })
    const plan = planSync([settled], [product()], print)
    expect(plan.update).toEqual([])
  })

  it('offers a watch whose record has moved since the last push', () => {
    const moved = watch({ shopifyFingerprint: 'something-else' })
    const plan = planSync([moved], [product()], print)
    expect(plan.update.map((u) => u.reasons)).toEqual([['record']])
  })

  it('offers a watch that has never been pushed', () => {
    // Null is "we do not know", which is the one answer that must never be
    // read as "nothing to do" — it is also every row on the day this ships.
    const plan = planSync([watch()], [product()], print)
    expect(plan.update.map((u) => u.reasons)).toEqual([['unknown']])
  })

  it('offers a watch the shop has archived behind our back', () => {
    // The fingerprint only knows what we sent. Somebody archiving the page in
    // the admin is exactly the drift a mirror has to notice.
    const settled = watch({ shopifyFingerprint: print(watch()) })
    const plan = planSync([settled], [product({ status: 'ARCHIVED' })], print)
    expect(plan.update.map((u) => u.reasons)).toEqual([['status']])
  })

  it('offers a watch whose page is in no sales channel', () => {
    const settled = watch({ shopifyFingerprint: print(watch()) })
    const plan = planSync([settled], [product({ publishedAt: null })], print)
    expect(plan.update.map((u) => u.reasons)).toEqual([['invisible']])
  })

  it('offers a watch that has been renumbered onto its old page', () => {
    // The page is claimed by the id we remembered, not by its SKU — which is
    // the whole point: the accounts renumbered the piece and the page must
    // follow rather than be archived and rebuilt.
    const settled = watch({
      stockNo: 1200,
      shopifyProductId: 'gid://shopify/Product/1',
      shopifyFingerprint: print(watch({ stockNo: 1200, shopifyProductId: 'gid://shopify/Product/1' })),
    })
    const plan = planSync([settled], [product({ sku: '1143' })], print)
    expect(plan.update.map((u) => u.reasons)).toEqual([['renumbered']])
  })

  it('still offers everything when it cannot work out what changed', () => {
    // No fingerprint function: the rates or the taxonomy would not load. A
    // sync that re-sends too much is wasteful; one that skips a watch
    // because it could not read the rate table is wrong.
    const settled = watch({ shopifyFingerprint: 'anything' })
    expect(planSync([settled], [product()]).update).toHaveLength(1)
  })
})

describe('recording what was pushed', () => {
  const service = read('src/server/services/shopify-service.ts')

  it('fingerprints the photographs as they end up, not as they arrived', () => {
    // This push is where a picture first gets a media row. Fingerprinting the
    // state we walked in with would never match again, and the watch would
    // offer itself for update for ever — the exact fault being fixed.
    expect(service).toMatch(/fingerprintFor\(\s*\{ \.\.\.watch, images \}/)
  })

  it('declines to fingerprint a push whose photographs could not be matched', () => {
    expect(service).toMatch(/const fingerprint = taxonomy && images/)
  })

  it('writes it down on the row beside the product id', () => {
    expect(service).toMatch(/shopifyFingerprint: fingerprint/)
  })

  it('predicts the fields from the same function that writes them', () => {
    // Two definitions of "what we send" drifting apart would mean a field
    // somebody edits silently stops reaching the shop.
    expect(service.match(/metafieldsFor\(watch, taxonomy\)/g)?.length).toBe(3)
  })
})

describe('the entries the shop is missing', () => {
  it('creates a material it has never heard of', () => {
    expect((CREATABLE_TYPES as readonly string[])).toContain('material')
    expect(isCreatable({ type: 'material', name: 'Titanium' })).toBe(true)
  })

  it('creates a family that is a family', () => {
    expect(isCreatable({ type: 'model', name: 'Air-King' })).toBe(true)
    expect(creatableName({ type: 'model', name: 'Air-King' })).toBe('Air-King')
  })

  it('refuses a family that is a whole variant', () => {
    // A filter holding one watch is worse than a watch holding no filter:
    // the first is six Submariners in the menu, the second is a gap someone
    // can fill in an afternoon.
    expect(isCreatable({ type: 'model', name: 'Submariner Date Green Hulk' })).toBe(false)
    expect(creatableName({ type: 'model', name: 'Submariner Date Green Hulk 41' })).toBeNull()
  })

  it('refuses anything carrying a reference number', () => {
    expect(creatableName({ type: 'model', name: 'Datejust 116334' })).toBeNull()
  })

  it('still lets a year and a case size through, numbers and all', () => {
    expect(creatableName({ type: 'year', name: '2019' })).toBe('2019')
    expect(creatableName({ type: 'case_size', name: '43mm' })).toBe('43mm')
  })

  it('leaves the closed vocabularies alone', () => {
    // A brand or a grade we cannot match means we have spelled it
    // differently, never that the shop is short of one.
    expect(isCreatable({ type: 'brand', name: 'Rolex' })).toBe(false)
    expect(isCreatable({ type: 'condition', name: 'Unworn' })).toBe(false)
  })
})
