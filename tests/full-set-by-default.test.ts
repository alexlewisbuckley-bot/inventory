import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { desiredMetaobjects } from '@/lib/shopify-metafields'
import { watchCreateSchema, watchRequestSchema } from '@/lib/validation'
import type { SyncWatch } from '@/lib/shopify-map'

const read = (path: string) => readFileSync(path, 'utf8')
const migration = read('src/server/db/migrations/0057_full_set_unless_said_otherwise.sql')
const schema = read('src/server/db/schema.ts')
const form = read('src/components/inventory/WatchForm.tsx')

/**
 * Full set unless somebody says otherwise.
 *
 * Alex: "Lots of watches are being imported without full set on website, can
 * we have default for import and new watches to be full set we can update to
 * watch only where required as 99% of stock is full set."
 *
 * UNKNOWN was the honest default while nobody could say what the stock was.
 * It is not the honest default for this stock, and a column whose value is
 * wrong on ninety-nine rows in a hundred is not caution — it is noise with a
 * clean conscience, and it left the one fact a buyer of a second-hand watch
 * asks about first missing from most of the shop.
 */

const watch = (boxPapers: string): SyncWatch => ({
  id: 'wch_1', stockNo: 1, brandName: 'Rolex', model: '126610LN', serial: null,
  modelName: 'Submariner Date', year: null, status: 'IN_STOCK',
  locationName: 'Dubai', locationPublishes: true, estSaleGbp: 1_000_000,
  caseSizeMm: null, caseMaterial: null, dial: null, dialStyle: null,
  bracelet: null, movement: null, waterResistanceM: null,
  condition: 'UNKNOWN', boxPapers, description: null,
  images: [], shopifyProductId: null,
})

const boxPapersOn = (boxPapers: string) =>
  desiredMetaobjects(watch(boxPapers)).find((want) => want.type === 'box_papers')

describe('what the website is told', () => {
  it('said nothing at all while the value was UNKNOWN', () => {
    // The complaint, in one assertion: no metafield means no box-and-papers
    // line on the product and nothing to filter the shop by.
    expect(boxPapersOn('UNKNOWN')).toBeUndefined()
  })

  it('says full set once the watch carries it', () => {
    // Under the storefront's own name for it. The shop files "full set";
    // the website filter has always read "Box & papers", and the alias
    // table is where those two meet.
    expect(boxPapersOn('FULL_SET')).toMatchObject({ type: 'box_papers', name: 'Box & papers' })
  })

  it('still says the exception where there is one', () => {
    // The point of the default is that the 1% stays sayable.
    expect(boxPapersOn('WATCH_ONLY')).toMatchObject({ type: 'box_papers', name: 'Neither' })
    expect(boxPapersOn('BOX_ONLY')).toMatchObject({ type: 'box_papers', name: 'Box only' })
    expect(boxPapersOn('PAPERS_ONLY')).toMatchObject({ type: 'box_papers', name: 'Papers only' })
  })
})

describe('a watch starts as a full set', () => {
  it('through the form', () => {
    expect(watchCreateSchema.parse({
      brandId: 'brn_1', model: '126610LN', supplierId: 'sup_1',
      purchaseDate: '2026-11-11', purchaseAmount: '1000', purchaseCurrency: 'AED',
      locationId: 'loc_1',
    }).boxPapers).toBe('FULL_SET')
  })

  it('through every other door, by the column default', () => {
    /*
     * The spreadsheet import, the invoice booking and a defaulted buy-back
     * all insert without naming this column, so the database decides. One
     * default covers all three — which is why it is set there and not in
     * three services that would drift apart.
     */
    expect(migration).toMatch(/ALTER TABLE watches\s+ALTER COLUMN box_papers SET DEFAULT 'FULL_SET'/)
    expect(schema).toMatch(/boxPapers: text\('box_papers', \{ enum: BOX_PAPERS \}\)\.notNull\(\)\.default\('FULL_SET'\)/)
  })

  it('on a blank form, so the screen agrees with what will be saved', () => {
    expect(form).toMatch(/boxPapers: 'FULL_SET'/)
  })

  it('but a customer want still means no preference', () => {
    /*
     * The same column on a different table, and the opposite meaning: a want
     * records what a customer will accept, where UNKNOWN is a real answer.
     * Defaulting it would turn every loose enquiry into a demand for a full
     * set and quietly narrow what we offer them.
     */
    expect(watchRequestSchema.parse({ customerId: 'cus_1' }).boxPapers).toBe('UNKNOWN')
    expect(schema).toMatch(/boxPapers: text\('box_papers', \{ enum: BOX_PAPERS \}\)\.notNull\(\)\.default\('UNKNOWN'\)/)
    expect(migration).not.toMatch(/watch_requests/i.source ? /ALTER TABLE watch_requests/ : /x^/)
  })
})

describe('the stock already on the book', () => {
  it('is brought up to the default, which is what the website is showing today', () => {
    expect(migration).toMatch(/UPDATE watches\s+SET box_papers = 'FULL_SET'/)
    expect(migration).toMatch(/WHERE box_papers = 'UNKNOWN'/)
  })

  it('leaves a watch that has already gone exactly as it was', () => {
    /*
     * A sold record describes a watch the buyer was told something about.
     * Rewriting it is changing history rather than fixing the shop — and it
     * would put a claim in the file that nobody made at the time.
     */
    const update = migration.slice(migration.indexOf('UPDATE watches'))
    expect(update).toMatch(/status NOT IN \('SOLD', 'WRITTEN_OFF'\)/)
    expect(update).toMatch(/deleted_at IS NULL/)
  })

  it('leaves anything somebody actually answered', () => {
    // Only UNKNOWN is touched, so a watch filed as watch-only stays that way.
    const update = migration.slice(migration.indexOf('UPDATE watches'))
    expect(update).not.toMatch(/box_papers <> |box_papers != /)
  })

  it('writes down every row it changes, so the batch can be undone', () => {
    const insert = migration.slice(migration.indexOf('INSERT INTO audit_logs'))
    expect(insert).toMatch(/'watch',\s*\n\s*w\.id,\s*\n\s*'UPDATE'/)
    expect(insert).toMatch(/"boxPapers":\{"from":"UNKNOWN","to":"FULL_SET"\}/)
    // The same rows as the update, or the record is of something else.
    expect(insert).toMatch(/status NOT IN \('SOLD', 'WRITTEN_OFF'\)/)
    expect(insert).toMatch(/deleted_at IS NULL/)
    // Before the update, or it reads the value it just wrote.
    expect(migration.indexOf('INSERT INTO audit_logs')).toBeLessThan(migration.indexOf('UPDATE watches'))
  })

  it('bumps the row version it changed', () => {
    // A form opened before this ran should get the conflict it deserves
    // rather than silently writing UNKNOWN back over the row.
    expect(migration).toMatch(/version = version \+ 1/)
  })
})

describe('the fold on the edit form', () => {
  it('stops counting full set as something worth opening for', () => {
    /*
     * It opens Additional details when there is something notable in there.
     * Full set is now what nearly every watch is, so counting it would open
     * the section on every edit and the fold would stop meaning anything.
     */
    expect(form).toMatch(/initial\.boxPapers !== 'UNKNOWN' && initial\.boxPapers !== 'FULL_SET'/)
  })
})
