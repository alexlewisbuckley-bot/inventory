import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(
  join(process.cwd(), 'src/components/inventory/ContentGrid.tsx'),
  'utf8',
)

/**
 * The grid's widths have to add up, and nothing else checks that they do.
 *
 * Two columns were added and the table's minimum width was not raised with
 * them. A table lays itself out automatically, so a declared width is only a
 * hint: with seventeen columns asking for 1,724px inside a 1,280px minimum,
 * the browser honoured none of them and squeezed every column instead. The
 * Model name column asked for 170px and rendered at 91, which is not wide
 * enough to read "Royal Oak Concept" — and it looked like a rendering fault
 * rather than an arithmetic one.
 *
 * The frozen columns fail worse. Each is positioned by a hard-coded offset
 * that is the sum of the widths to its left, so a column that renders wider
 * than it declared pushes the frozen block over the top of the one after it.
 * That is what put "Model name" under "Brand" and left the header reading
 * "le".
 *
 * So: the arithmetic is the contract, and this is where it is checked. Add a
 * column and this test fails until the minimum width is raised to match.
 */
describe('the content grid adds up', () => {
  const pin = (name: string) => {
    const match = new RegExp(`const ${name} = '[^']*?\\bw-\\[(\\d+)px\\]`).exec(source)
    if (!match) throw new Error(`no width found for ${name}`)
    return Number(match[1])
  }

  const frozen = {
    photo: pin('PIN_PHOTO'),
    stock: pin('PIN_STOCK'),
    brand: pin('PIN_BRAND'),
    name: pin('PIN_NAME'),
  }

  /**
   * Only the scrolling fields. NAME_FIELD declares a width too, but it is
   * already counted in the frozen block as PIN_NAME — counting it twice was
   * this test's own first bug, and it reported 1,884 for a 1,724px table.
   */
  const fieldsBlock = source.slice(
    source.indexOf('const FIELDS: Field[] = ['),
    source.indexOf('/** One cell'),
  )
  const fieldWidths = [...fieldsBlock.matchAll(/width:\s*(\d+)/g)].map((m) => Number(m[1]))

  const done = Number(/<th className={cn\(HEAD, 'w-\[(\d+)px\]'\)}>Done<\/th>/.exec(source)?.[1] ?? 0)

  /** The table's own minimum, not the first `min-w` that appears in the file. */
  const declaredMin = Number(/<table className="[^"]*?min-w-\[(\d+)px\]/.exec(source)?.[1] ?? 0)

  it('states a minimum width at least as wide as its columns', () => {
    const total = Object.values(frozen).reduce((a, b) => a + b, 0)
      + fieldWidths.reduce((a, b) => a + b, 0)
      + done
    // At least, not exactly: a little slack is harmless, and squeezing is
    // the only failure that matters.
    expect(declaredMin).toBeGreaterThanOrEqual(total)
  })

  it('positions each frozen column at the sum of the widths to its left', () => {
    // The offsets are what hold the freeze together. One wrong and a column
    // disappears under its neighbour.
    const offset = (name: string) =>
      Number(new RegExp(`const ${name} = 'left-\\[?(\\d+)`).exec(source)?.[1] ?? -1)

    expect(/const PIN_PHOTO = 'left-0/.test(source)).toBe(true)
    expect(offset('PIN_STOCK')).toBe(frozen.photo)
    expect(offset('PIN_BRAND')).toBe(frozen.photo + frozen.stock)
    expect(offset('PIN_NAME')).toBe(frozen.photo + frozen.stock + frozen.brand)
  })

  it('bounds every frozen column on both sides', () => {
    // A `width` alone is advisory on a table cell. Without min and max the
    // column grows to its content — "Audemars Piguet" — and the offsets
    // above stop describing reality.
    for (const name of ['PIN_PHOTO', 'PIN_STOCK', 'PIN_BRAND', 'PIN_NAME']) {
      const line = new RegExp(`const ${name} = '([^']*)'`).exec(source)?.[1] ?? ''
      const width = pin(name)
      expect(line, `${name} needs min-w`).toContain(`min-w-[${width}px]`)
      expect(line, `${name} needs max-w`).toContain(`max-w-[${width}px]`)
    }
  })

  it('freezes through the column that names the row', () => {
    // Stock and brand alone do not say which watch a row is. Freezing stops
    // at the model name for the same reason a spreadsheet's does.
    expect(source).toMatch(/const NAME_FIELD: Field = \{ key: 'modelName'/)
    expect(source).toMatch(/PIN_NAME[\s\S]{0,120}?NAME_FIELD\.label/)
  })
})
