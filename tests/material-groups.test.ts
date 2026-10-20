import { describe, expect, it } from 'vitest'
import { MATERIAL_GROUPS, materialGroup, creatableName, isCreatable } from '@/lib/shopify-metafields'

/**
 * The shop's material filter had fourteen entries because it was showing the
 * trade's vocabulary: Oystersteel and Stainless Steel as two things, three
 * kinds of Rolesor, four golds split by carat, a Rolesium holding one watch.
 * These are the fourteen that were actually on the site, with the counts they
 * carried, and where each one now lands.
 */
describe('every material that was on the shop', () => {
  const observed: Array<[string, string]> = [
    ['Oystersteel', 'Steel'],                            // 30
    ['Two-tone Yellow Rolesor', 'Steel & Yellow Gold'],  // 28
    ['Two-tone White Rolesor', 'Steel & White Gold'],    // 29
    ['Two-tone Everose Rolesor', 'Steel & Rose Gold'],   // 24
    ['18k Yellow Gold', 'Yellow Gold'],                  // 7
    ['18k White Gold', 'White Gold'],                    // 6
    ['18k Everose Gold', 'Rose Gold'],                   // 4
    ['18k Rose Gold', 'Rose Gold'],                      // 4
    ['950 Platinum', 'Platinum'],                        // 1
    ['Stainless Steel', 'Steel'],                        // 1
    ['Titanium', 'Titanium'],                            // 1
    ['14k Yellow Gold', 'Yellow Gold'],                  // 1
    ['Rolesium', 'Platinum'],                            // 1
    ['Titanium and Platinum', 'Titanium'],               // 1
  ]

  for (const [from, to] of observed) {
    it(`files ${from} under ${to}`, () => {
      expect(materialGroup(from)).toBe(to)
    })
  }

  it('leaves nothing on the shop unfiled', () => {
    expect(observed.every(([from]) => materialGroup(from) !== null)).toBe(true)
  })

  it('produces only the nine, and nothing else', () => {
    const produced = new Set(observed.map(([, to]) => to))
    for (const group of produced) {
      expect(MATERIAL_GROUPS as readonly string[]).toContain(group)
    }
  })
})

describe('the order the rules are read in', () => {
  it('reads a two-tone as a two-tone, not as gold', () => {
    // Testing for gold first would file every Rolesor under gold.
    expect(materialGroup('Oystersteel and yellow gold')).toBe('Steel & Yellow Gold')
    expect(materialGroup('Oystersteel and Everose gold')).toBe('Steel & Rose Gold')
  })

  it('reads Titanium and Platinum as titanium', () => {
    // Two metals named; the case wins, at Alex's word.
    expect(materialGroup('Titanium and Platinum')).toBe('Titanium')
  })

  it('does not mistake Everose for white or yellow', () => {
    expect(materialGroup('18k Everose Gold')).toBe('Rose Gold')
  })

  it('takes the carat off a solid gold', () => {
    // 14k and 18k are the same filter to somebody shopping.
    expect(materialGroup('14k Yellow Gold')).toBe(materialGroup('18k Yellow Gold'))
  })
})

describe('what it refuses to guess at', () => {
  it('returns nothing for a blank', () => {
    expect(materialGroup(null)).toBeNull()
    expect(materialGroup('')).toBeNull()
    expect(materialGroup('   ')).toBeNull()
  })

  it('returns nothing for a metal it does not know', () => {
    // Reported as a gap rather than filed under the wrong metal.
    expect(materialGroup('Ceramic')).toBeNull()
    expect(materialGroup('Bronze')).toBeNull()
  })

  it('is idempotent, so running it twice cannot drift', () => {
    for (const group of MATERIAL_GROUPS) {
      expect(materialGroup(group)).toBe(group)
    }
  })
})

describe('creating the nine in Shopify', () => {
  it('lets the four-word ones through the name gate', () => {
    // "Steel & Yellow Gold" is four words, which the gate refuses by default.
    expect(creatableName({ type: 'material', name: 'Steel & Yellow Gold' })).toBe('Steel & Yellow Gold')
    expect(isCreatable({ type: 'material', name: 'Steel & Rose Gold' })).toBe(true)
    expect(isCreatable({ type: 'material', name: 'Steel & White Gold' })).toBe(true)
  })

  it('still refuses a four-word material that is not one of them', () => {
    expect(creatableName({ type: 'material', name: 'Oystersteel and Everose gold' })).toBeNull()
  })
})
