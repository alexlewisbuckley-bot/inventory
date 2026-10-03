import { describe, expect, it } from 'vitest'
import { referenceKey } from '@/server/services/image-service'

/**
 * One reference, one shelf.
 *
 * The library is only useful if `126711 CHNR`, `126711-chnr` and
 * `126711CHNR` are the same model. Three spellings means three shelves, and
 * three shelves means the photograph taken last March is not found when the
 * next one of these comes in — which is the whole thing this exists to stop.
 */
describe('shelving a photograph by reference', () => {
  it('reads separators and case as noise', () => {
    const want = '126711CHNR'
    for (const spelling of ['126711CHNR', '126711 CHNR', '126711-chnr', ' 126711_CHNR ', '126711/chnr']) {
      expect(referenceKey(spelling)).toBe(want)
    }
  })

  it('keeps references that differ by a character apart', () => {
    expect(referenceKey('116610LV')).not.toBe(referenceKey('116610LN'))
    expect(referenceKey('5167R')).not.toBe(referenceKey('5167G'))
  })

  /** The field is free text, and some of it reads `Explorer II 343591`. */
  it('shelves a reference written as a phrase under the whole phrase', () => {
    expect(referenceKey('Explorer II 343591')).toBe('EXPLORERII343591')
    expect(referenceKey('explorer ii 343591')).toBe('EXPLORERII343591')
  })

  /** Nothing to shelve under is not a shelf called "". */
  it('gives nothing back for a reference that is only punctuation', () => {
    expect(referenceKey('')).toBe('')
    expect(referenceKey('  -- ')).toBe('')
  })
})
