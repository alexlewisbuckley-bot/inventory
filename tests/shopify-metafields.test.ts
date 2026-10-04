import { describe, expect, it } from 'vitest'
import {
  desiredMetaobjects, familyOf, indexMetaobjects, METAOBJECT_TYPES, normalise, resolveMetafields,
} from '@/lib/shopify-metafields'
import type { SyncWatch } from '@/lib/shopify-map'

const watch = (over: Partial<SyncWatch> = {}): SyncWatch => ({
  id: 'wch_1', stockNo: 1143, brandName: 'Rolex', model: '116334', serial: null,
  nickname: null, year: 2016, status: 'IN_STOCK', locationName: 'Dubai', estSaleGbp: 1020000,
  caseSizeMm: 41, caseMaterial: 'Oystersteel', dial: 'White', bracelet: 'Oyster',
  movement: null, waterResistanceM: null, condition: 'EXCELLENT',
  boxPapers: 'PAPERS_ONLY', description: null, imageIds: [], shopifyProductId: null,
  ...over,
})

/** The shop's real taxonomy, as it stands. */
const INDEX = indexMetaobjects([
  { type: 'brand', displayName: 'Rolex', id: 'gid://b/1' },
  { type: 'dial', displayName: 'White', id: 'gid://d/1' },
  { type: 'dial', displayName: 'Mother of Pearl', id: 'gid://d/2' },
  { type: 'dial', displayName: 'Silvered', id: 'gid://d/3' },
  { type: 'bracelet', displayName: 'Oyster', id: 'gid://br/1' },
  { type: 'material', displayName: 'Oystersteel', id: 'gid://m/1' },
  { type: 'material', displayName: '18k White Gold', id: 'gid://m/2' },
  { type: 'case_size', displayName: '41mm', id: 'gid://c/1' },
  { type: 'case_size', displayName: '41mm', id: 'gid://c/2' },
  { type: 'year', displayName: '2016', id: 'gid://y/1' },
  { type: 'condition', displayName: 'Excellent', id: 'gid://cn/1' },
  { type: 'box_papers', displayName: 'Papers only', id: 'gid://bp/1' },
  { type: 'box_papers', displayName: 'Box & papers', id: 'gid://bp/2' },
  { type: 'box_papers', displayName: 'Neither', id: 'gid://bp/3' },
])

describe('matching two vocabularies', () => {
  it('ignores case, spacing and punctuation', () => {
    // One person typed "Mother-of-pearl" and another typed "Mother of Pearl".
    // That is not a disagreement about the dial.
    expect(normalise('Mother-of-pearl')).toBe(normalise('Mother of Pearl'))
    expect(normalise('18k White Gold')).toBe(normalise('18K  white gold'))
  })

  it('keeps genuinely different words apart', () => {
    expect(normalise('Oystersteel')).not.toBe(normalise('Stainless Steel'))
  })
})

describe('what the shop should say about a watch', () => {
  it('asks for every structured field the record holds', () => {
    const want = desiredMetaobjects(watch())
    expect(want).toEqual([
      { type: 'brand', name: 'Rolex' },
      { type: 'dial', name: 'White' },
      { type: 'bracelet', name: 'Oyster' },
      { type: 'material', name: 'Oystersteel' },
      { type: 'case_size', name: '41mm' },
      { type: 'year', name: '2016' },
      { type: 'condition', name: 'Excellent' },
      { type: 'box_papers', name: 'Papers only' },
    ])
  })

  it('says nothing about what is not recorded', () => {
    const want = desiredMetaobjects(watch({ condition: 'UNKNOWN', boxPapers: 'UNKNOWN', dial: null }))
    expect(want.map((w) => w.type)).not.toContain('condition')
    expect(want.map((w) => w.type)).not.toContain('box_papers')
    expect(want.map((w) => w.type)).not.toContain('dial')
  })

  it('translates where the two systems use different words', () => {
    // "Full set" here is "Box & papers" there; "Watch only" is "Neither".
    expect(desiredMetaobjects(watch({ boxPapers: 'FULL_SET' })))
      .toContainEqual({ type: 'box_papers', name: 'Box & papers' })
    expect(desiredMetaobjects(watch({ boxPapers: 'WATCH_ONLY' })))
      .toContainEqual({ type: 'box_papers', name: 'Neither' })
    expect(desiredMetaobjects(watch({ dial: 'Silver' })))
      .toContainEqual({ type: 'dial', name: 'Silvered' })
    expect(desiredMetaobjects(watch({ caseMaterial: '18ct white gold' })))
      .toContainEqual({ type: 'material', name: '18k White Gold' })
  })

  it('leaves the model alone', () => {
    // The shop's model entries are families — "Datejust II" — and this
    // system's model column is the reference number. Matching them would pair
    // a 116334 with whichever family normalised the same way.
    expect(desiredMetaobjects(watch()).map((w) => w.type)).not.toContain('model')
  })
})

describe('resolving against the shop', () => {
  it('points each field at the shop’s own entry', () => {
    const { metafields, unmatched } = resolveMetafields(watch(), INDEX)
    expect(unmatched).toEqual([])
    expect(metafields).toContainEqual({
      namespace: 'custom', key: 'dial', type: 'metaobject_reference', value: 'gid://d/1',
    })
    expect(metafields).toHaveLength(8)
  })

  it('matches across a spelling difference', () => {
    const { metafields } = resolveMetafields(watch({ dial: 'Mother-of-pearl' }), INDEX)
    expect(metafields).toContainEqual({
      namespace: 'custom', key: 'dial', type: 'metaobject_reference', value: 'gid://d/2',
    })
  })

  it('picks one entry consistently when the shop has two of the same name', () => {
    // The store really does have two entries called "41mm".
    const { metafields } = resolveMetafields(watch(), INDEX)
    expect(metafields).toContainEqual({
      namespace: 'custom', key: 'case_size', type: 'metaobject_reference', value: 'gid://c/1',
    })
  })

  it('leaves a field out rather than guessing, and says which', () => {
    // A watch listed with the wrong dial is a statement; one listed with none
    // is an omission somebody can fill in.
    const { metafields, unmatched } = resolveMetafields(
      watch({ bracelet: 'President', dial: 'Tapestry' }), INDEX,
    )
    expect(metafields.map((m) => m.key)).not.toContain('bracelet')
    expect(metafields.map((m) => m.key)).not.toContain('dial')
    expect(unmatched).toEqual([
      { type: 'dial', name: 'Tapestry' },
      { type: 'bracelet', name: 'President' },
    ])
  })
})

/**
 * The family a watch belongs to.
 *
 * The shop's brand menu and its Model filter both group by this. It is the one
 * field the record does not hold directly — `model` here is the reference
 * number, which is what a dealer files by, while a shop window is browsed by
 * name — so it comes from the nickname, which is where the name actually sits.
 */
describe('the model family', () => {
  it('takes the case size off, because a 41 and a 31 are one family', () => {
    expect(familyOf(watch({ nickname: 'Datejust 41' }))).toBe('Datejust')
    expect(familyOf(watch({ nickname: 'Lady-Datejust 28' }))).toBe('Lady-Datejust')
    expect(familyOf(watch({ nickname: 'Day-Date 40' }))).toBe('Day-Date')
  })

  it('leaves a name that has no size on it alone', () => {
    expect(familyOf(watch({ nickname: 'Sky-Dweller' }))).toBe('Sky-Dweller')
    expect(familyOf(watch({ nickname: 'Datejust II' }))).toBe('Datejust II')
    expect(familyOf(watch({ nickname: 'GMT-Master II' }))).toBe('GMT-Master II')
  })

  it('does not mistake part of a name for a measurement', () => {
    // "RM 011" is a Richard Mille, not an RM in 11mm. "Nautilus 5711" is a
    // reference, not a case size.
    expect(familyOf(watch({ nickname: 'RM 011' }))).toBe('RM 011')
    expect(familyOf(watch({ nickname: 'Nautilus 5711' }))).toBe('Nautilus 5711')
    expect(familyOf(watch({ nickname: 'Royal Oak' }))).toBe('Royal Oak')
  })

  it('says nothing rather than guessing from the reference', () => {
    // A reference prefix implies a family only to somebody who already knows
    // the numbering, and a menu confidently filed under the wrong name is
    // worse than one with a gap in it.
    expect(familyOf(watch({ nickname: null }))).toBeNull()
    expect(familyOf(watch({ nickname: '   ' }))).toBeNull()
  })

  it('matches the shop’s entry across its own spelling', () => {
    // The shop files these without hyphens; Rolex writes them with. That is a
    // spelling difference, not a different watch.
    const index = indexMetaobjects([
      { type: 'model', displayName: 'GMT Master II', id: 'gid://mo/1' },
      { type: 'model', displayName: 'Sky Dweller', id: 'gid://mo/2' },
      { type: 'model', displayName: 'Daytona', id: 'gid://mo/3' },
    ])
    const of = (nickname: string) =>
      resolveMetafields(watch({ nickname }), index).metafields.find((m) => m.key === 'model')?.value

    expect(of('GMT-Master II')).toBe('gid://mo/1')
    expect(of('Sky-Dweller')).toBe('gid://mo/2')
    // Rolex's full name for the family the shop files as "Daytona".
    expect(of('Cosmograph Daytona')).toBe('gid://mo/3')
  })
})

/**
 * The loader and the asker have to agree.
 *
 * `model` was added to what the sync asks for and not to what it loads from
 * the shop, so it looked a family up in an index that had never been told
 * families exist. Every watch came back unmatched and the brand menu the
 * change existed to fix stayed exactly as it was — silently, because an
 * unmatched field is a normal, reportable outcome.
 */
describe('what is asked for and what is loaded', () => {
  it('loads every type a watch can ask for', () => {
    const asked = new Set(desiredMetaobjects(watch({
      nickname: 'Datejust 41', dial: 'White', bracelet: 'Oyster',
      caseMaterial: 'Oystersteel', caseSizeMm: 41, year: 2016,
      condition: 'EXCELLENT', boxPapers: 'PAPERS_ONLY',
    })).map((w) => w.type))

    for (const type of asked) {
      expect(METAOBJECT_TYPES, `${type} is asked for but never loaded`).toContain(type)
    }
  })
})
