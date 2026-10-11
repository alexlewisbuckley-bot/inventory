import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE_CURRENCY, CURRENCY_SYMBOLS } from '@/lib/enums'
import { describeClause, operatorsFor, WATCH_FIELDS } from '@/lib/filters'

/**
 * The `+ Filter` menu, and what happened when you used it.
 *
 * Eighteen entries, two of them both called "Model", and seven that did
 * nothing whatsoever when chosen. The last is the one worth a test: a field
 * with no list of choices had no seed value, `add` fell off the end of itself
 * without writing a clause, and the menu simply shut. Cost, Retail, Year,
 * Case size and Bought were advertised and inert — which reads, correctly, as
 * the filter bar being broken.
 *
 * Underneath that, the money ones were also lying. Clause values are major
 * units of the stored currency, which has been dollars since 0018, and both
 * the chip and the budget slider printed them behind a pound sign. "Retail is
 * under £7,000" described a filter on seven thousand dollars.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
/** The same file with its prose taken out, for asserting about what it does. */
const code = (path: string) => read(path)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')

describe('what the menu offers', () => {
  it('calls no two things by the same name', () => {
    // `model` was a text filter over the reference and `family` is the model
    // a customer asks for, and both were labelled "Model". Whichever you
    // picked, the other one was the one you wanted.
    const labels = WATCH_FIELDS.map((field) => field.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('offers nothing the search box already does better', () => {
    // One box matches the model, the serial, the nickname, the brand and the
    // stock number. Two `contains` chips reaching two of those columns is
    // three taps to do less.
    for (const gone of ['model', 'serial']) {
      expect(WATCH_FIELDS.find((field) => field.key === gone), gone).toBeUndefined()
    }
  })

  it('keeps the cut between the two businesses sharing the list', () => {
    // Type was nearly cut as a filter with only one answer — the handbags are
    // not live on the website — and they are a seventh of the stock.
    expect(WATCH_FIELDS.find((field) => field.key === 'productType')).toBeDefined()
  })

  it('reads in bands rather than as one column of fifteen', () => {
    // Where it stands, what it is, what it is worth, what the record owes.
    const groups = WATCH_FIELDS.map((field) => field.group)
    expect(groups.every(Boolean)).toBe(true)
    // Contiguous, or the rules between them land in the middle of a group.
    const order = groups.filter((group, index) => group !== groups[index - 1])
    expect(new Set(order).size).toBe(order.length)
    expect(order).toEqual(['where', 'what', 'worth', 'record'])
  })

  it('draws a rule where the band changes, and nowhere else', () => {
    const bar = read('src/components/ui/DataList/FilterBar.tsx')
    expect(bar).toMatch(/separated: index > 0 && field\.group !== addable\[index - 1\]\?\.group/)
  })
})

describe('choosing a field that has no list of values', () => {
  it('is possible at all', () => {
    // The fault: `add` seeded enum and reference fields from their first
    // option and returned empty-handed for everything else. The guard that
    // made it a no-op is gone, and a draft chip is opened instead.
    const bar = read('src/components/ui/DataList/FilterBar.tsx')
    expect(bar).toMatch(/setDraft\(\{ field: field\.key, operator, values: \[\] \}\)/)
    expect(bar).toMatch(/<FilterChip[\s\S]{0,400}draft\n/)
  })

  it('does not put a half-typed filter in the URL', () => {
    // "Cost is over 0", written so it can be corrected, is a filter nobody
    // asked for in front of the list and in anything saved from it.
    const bar = read('src/components/ui/DataList/FilterBar.tsx')
    expect(bar).toMatch(/const \[draft, setDraft\] = useState<FilterClause \| null>\(null\)/)
    const commit = bar.slice(bar.indexOf('onChange={(next) => {\n              setDraft(null)'))
    expect(commit.slice(0, 160)).toMatch(/replaceClauses\(\[\.\.\.clauses, next\]\)/)
  })

  it('opens one input rather than an empty list of choices', () => {
    const chip = read('src/components/ui/DataList/FilterChip.tsx')
    expect(chip).toMatch(/const typed = !listed && !VALUELESS\.has\(clause\.operator\)/)
    expect(chip).toMatch(/function ValueEditor/)
    // Enter applies, Escape abandons, and abandoning a draft removes its chip.
    expect(chip).toMatch(/event\.key === 'Enter'/)
    expect(chip).toMatch(/if \(draft\) onRemove\(\)/)
  })

  it('still reaches every field type the watch list has', () => {
    // A date, a number and two prices. If any of these ever loses its editor
    // again it is a dead button in a menu, which is the state this fixes.
    for (const key of ['purchaseDate', 'year', 'caseSizeMm', 'purchasePriceGbp', 'estSaleGbp']) {
      const field = WATCH_FIELDS.find((spec) => spec.key === key)!
      expect(field, key).toBeDefined()
      const first = operatorsFor(field)[0]!
      expect(['isEmpty', 'isNotEmpty'], key).not.toContain(first)
      expect(field.options ?? field.optionSource, key).toBeUndefined()
    }
  })
})

describe('money in a filter', () => {
  it('is never labelled with a currency it is not in', () => {
    // The fallback beneath any display-currency conversion: the symbol of the
    // currency the integers are actually stored in.
    expect(describeClause({ field: 'estSaleGbp', operator: 'lt', values: ['7000'] }, WATCH_FIELDS))
      .toBe(`Retail is under ${CURRENCY_SYMBOLS[BASE_CURRENCY]}7,000`)
    expect(read('src/lib/filters.ts')).not.toMatch(/`£\$\{major/)
  })

  it('is shown in the currency the person switched to', () => {
    for (const path of [
      'src/components/ui/DataList/FilterChip.tsx',
      'src/components/inventory/FindBar.tsx',
    ]) {
      const source = read(path)
      expect(source, path).toMatch(/useCurrency\(\)/)
      expect(source, path).toMatch(/CURRENCY_SYMBOLS\[currency\]/)
      expect(source, path).toMatch(/fromBase\(/)
      // No hard-coded symbol left in anything either of them draws. The
      // comments still name the one that was there, which is the point of them.
      expect(code(path), path).not.toMatch(/£/)
    }
  })

  it('is filtered on in stored units however it is typed', () => {
    // The column is in stored units and the facet was counted in them, so a
    // conversion on the way into the clause — rather than on the way out to
    // the label — would filter on a different number from the one on screen.
    const chip = read('src/components/ui/DataList/FilterChip.tsx')
    expect(chip).toMatch(/toBase\(Math\.round\(typed \* 100\), currency, rates\) \/ 100/)
    const bar = read('src/components/inventory/FindBar.tsx')
    expect(bar).toMatch(/Only\n   \* the labels move/)
  })
})

describe('the pill rows the find bar replaced', () => {
  it('are gone rather than left behind unused', () => {
    // `quick` was the prop that drew them. Nothing passed it after the find
    // bar landed, and an unused control in a shared component is one the next
    // list will find and wire up again.
    const bar = read('src/components/ui/DataList/FilterBar.tsx')
    expect(bar).not.toMatch(/QuickFilter/)
    expect(read('src/components/ui/DataList/index.ts')).not.toMatch(/QuickFilter/)
  })
})
