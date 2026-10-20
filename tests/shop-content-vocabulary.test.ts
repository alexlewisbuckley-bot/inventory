import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MATERIAL_GROUPS, materialGroup } from '@/lib/shopify-metafields'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

/**
 * The Shop content grid suggests values from the shop's own vocabulary. That
 * is right for a dial and wrong for a metal: everything written to a product
 * goes through materialGroup first, so offering the shop's fourteen entries
 * would suggest words that cannot survive a push — pick "Oystersteel" off the
 * list and the product is filed under Steel.
 */
describe('what the grid suggests for material', () => {
  const service = read('src/server/services/shopify-service.ts')

  it('offers the nine rather than whatever the shop happens to hold', () => {
    expect(service).toMatch(/choices\.material = \[\.\.\.MATERIAL_GROUPS\]/)
  })

  it('sets it after the alphabetical sort, so the order survives', () => {
    // Declared order groups the golds, then the single metals, then the
    // two-tones. Sorting would interleave them.
    const sort = service.indexOf('list.sort((a, b) => a.localeCompare(b))')
    const material = service.indexOf('choices.material = [...MATERIAL_GROUPS]')
    expect(sort).toBeGreaterThan(-1)
    expect(material).toBeGreaterThan(sort)
  })

  it('leaves every other field reading from the shop', () => {
    // Dial, bracelet and model are the shop's vocabulary and must stay so.
    expect(service).not.toMatch(/choices\.dial = /)
    expect(service).not.toMatch(/choices\.bracelet = /)
    expect(service).not.toMatch(/choices\.model = /)
  })

  it('still suggests only values that survive a push unchanged', () => {
    // The point of the change: everything offered is already grouped, so
    // picking one produces exactly what reaches the shop.
    for (const group of MATERIAL_GROUPS) {
      expect(materialGroup(group)).toBe(group)
    }
  })

  it('tells somebody reading the grid that material is grouped', () => {
    // Typing Oystersteel and seeing Steel on the website is correct and
    // startling, which is the same rule the price ladder follows.
    expect(read('src/app/(app)/inventory/content/page.tsx'))
      .toMatch(/recorded as Oystersteel reaches the website as Steel/)
  })
})
