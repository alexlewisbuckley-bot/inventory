import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { plural, pluralOf } from '@/lib/plural'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('putting a noun in the plural', () => {
  it('handles the one the whole system is about', () => {
    // "Showing 1–2 of 2 watchs", on the stock list, for as long as there has
    // been a stock list.
    expect(pluralOf('watch')).toBe('watches')
  })

  it('adds a syllable after a sibilant', () => {
    expect(pluralOf('box')).toBe('boxes')
    expect(pluralOf('glass')).toBe('glasses')
    expect(pluralOf('dish')).toBe('dishes')
    expect(pluralOf('waltz')).toBe('waltzes')
  })

  it('turns a consonant-y into -ies', () => {
    expect(pluralOf('entry')).toBe('entries')
    expect(pluralOf('company')).toBe('companies')
  })

  it('leaves a vowel-y alone', () => {
    // The rule tests the letter in front of the y, not the y itself —
    // otherwise days becomes daies.
    expect(pluralOf('day')).toBe('days')
    expect(pluralOf('key')).toBe('keys')
  })

  it('just adds s to everything ordinary', () => {
    expect(pluralOf('sale')).toBe('sales')
    expect(pluralOf('customer')).toBe('customers')
    expect(pluralOf('piece')).toBe('pieces')
    expect(pluralOf('brand')).toBe('brands')
    expect(pluralOf('dial')).toBe('dials')
    expect(pluralOf('metal')).toBe('metals')
  })

  it('spells out the words no rule gets right', () => {
    expect(pluralOf('person')).toBe('people')
    expect(pluralOf('Person')).toBe('People')
  })

  it('leaves one alone and pluralises none', () => {
    // Zero is plural in English: "No watches", not "No watch".
    expect(plural('watch', 1)).toBe('watch')
    expect(plural('watch', 2)).toBe('watches')
    expect(plural('watch', 0)).toBe('watches')
  })
})

describe('where it is used', () => {
  it('runs the pagination summary, rather than each caller guessing', () => {
    const source = read('src/components/ui/Pagination.tsx')
    expect(source).toMatch(/const counted = plural\(noun, total\)/)
    // The bug itself: a bare s on the end of whatever was passed in.
    expect(source).not.toMatch(/\$\{noun\}s`/)
  })

  it('runs the filter-bar summary too', () => {
    const source = read('src/components/inventory/FindBar.tsx')
    expect(source).toMatch(/pluralOf\(noun\)/)
    expect(source).not.toMatch(/\$\{noun\}s`/)
  })
})
