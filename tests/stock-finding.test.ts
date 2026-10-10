import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  HELD_STATUSES, MENS_MIN_MM, MISSING_FACTS, MISSING_FACT_LABELS,
  WEARS, WEARS_LABELS, WOMENS_MAX_MM,
} from '@/lib/enums'
import { WATCH_FIELDS, describeClause, operatorsFor, parseFilters, validateClause } from '@/lib/filters'
import { INVENTORY_VIEWS } from '@/components/inventory/views'

/**
 * Finding a watch for somebody standing in front of you.
 *
 * "Have you anything for my wife, around ten thousand?" is one sentence, and
 * answering it meant four trips through the filter menu — or, in practice,
 * answering from memory, which is how a watch sits unsold in a drawer.
 *
 * Two of these fields are not columns, and that is what these tests are for.
 * Men's and women's is read off the case size with deliberately OVERLAPPING
 * bands, and "missing something critical" is an OR across three unrelated
 * columns in a grammar that ANDs its clauses. Neither can be a column
 * binding, so neither is covered by the ordinary filter tests.
 *
 * The SQL they produce was run against a real Postgres during the change —
 * fourteen cases, including the midsize that has to appear in both lists and
 * the unmeasured watch that must appear in neither. What is kept here is
 * everything that can be checked without one.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('who a watch is for', () => {
  it('agrees with the storefront about where the line falls', () => {
    // osw-data.js has sorted the shop on these numbers since it was built. If
    // they ever disagree, the same watch is a lady's watch in one system and
    // a man's in the other, and nobody finds out from a screen.
    expect(WOMENS_MAX_MM).toBe(37)
    expect(MENS_MIN_MM).toBe(35)
  })

  it('leaves a midsize in both lists rather than picking one', () => {
    // The bands overlap on purpose: 35–37mm is worn by anyone, and forcing a
    // 36mm Datejust into one list means never showing it to half the people
    // it suits. The overlap is why this cannot be a CASE expression.
    expect(MENS_MIN_MM).toBeLessThanOrEqual(WOMENS_MAX_MM)
  })

  it('is offered as a filter, and only as a question', () => {
    const field = WATCH_FIELDS.find((spec) => spec.key === 'wears')
    expect(field).toBeDefined()
    expect(field!.options?.map((option) => option.value)).toEqual([...WEARS])
    // "Is empty" would be nonsense: every row has an answer, including "we
    // have not measured it", which is not the same as the field being blank.
    expect(operatorsFor(field!)).toEqual(['is', 'isNot'])
  })

  it('names both of them', () => {
    for (const value of WEARS) expect(WEARS_LABELS[value], value).toBeTruthy()
  })
})

describe('what a record is missing', () => {
  it('is the three facts that each stop something, not a tidiness score', () => {
    // Whose it is, which one it is, and how it can be sold. A missing dial
    // colour is a thinner listing; none of these three is survivable.
    expect([...MISSING_FACTS]).toEqual(['OWNER', 'SERIAL', 'VAT'])
    for (const fact of MISSING_FACTS) expect(MISSING_FACT_LABELS[fact], fact).toBeTruthy()
  })

  it('asks for any of them at once, because they go missing together', () => {
    const view = INVENTORY_VIEWS.find((entry) => entry.id === 'incomplete')
    expect(view).toBeDefined()
    const clauses = parseFilters(new URLSearchParams(view!.query), WATCH_FIELDS)
    expect(clauses).toContainEqual({ field: 'missing', operator: 'is', values: [...MISSING_FACTS] })
    // And only stock we still hold — a sold watch's paperwork is closed.
    expect(clauses).toContainEqual({ field: 'status', operator: 'is', values: [...HELD_STATUSES] })
  })

  it('counts the same watches the list it opens shows', () => {
    // The count and the query are written in two files and have to mean the
    // same thing; a queue whose number disagrees with its own list reads as
    // the number being broken. Same shape, same blank-serial handling.
    const counts = read('src/server/repositories/dashboard-repository.ts')
    const bindings = read('src/server/repositories/watch-repository.ts')
    for (const source of [counts, bindings]) {
      expect(source).toMatch(/ownerId\} is null/)
      expect(source).toMatch(/btrim\(\$\{watches\.serial\}\) = ''/)
      expect(source).toMatch(/vatScheme\} = 'UNKNOWN'/)
    }
  })
})

describe('browsing a caseful of watches', () => {
  /**
   * Five stacked rows of chips, with a hundred and eighteen Rolexes behind
   * them, was a wall: two hundred pixels of chrome before the first watch and
   * a "24 more" link doing a scrollbar's job. Budget was four fixed brackets,
   * which cannot express "about fifteen" however carefully they are chosen.
   *
   * One row of five controls now, each closed until asked. The counting and
   * the drawing need a database and a browser and were checked against both.
   * What is kept here is everything provable without either.
   */
  const field = (key: string) => WATCH_FIELDS.find((spec) => spec.key === key)

  it('asks the four questions a customer actually asks', () => {
    for (const key of ['brandId', 'family', 'estSaleGbp', 'caseSizeMm']) {
      expect(field(key), key).toBeDefined()
    }
  })

  it('treats a model family as an open list, not a closed one', () => {
    // An enum's values are checked against a fixed list; a family name is
    // whatever is in the case this morning. Declared as an enum it passed
    // every check and then had its values stripped on the way to the query,
    // so the filter silently returned the whole book.
    const family = field('family')!
    expect(family.type).toBe('reference')
    const clause = { field: 'family', operator: 'is' as const, values: ['Submariner'] }
    expect(validateClause(clause, WATCH_FIELDS)).toEqual(clause)
  })

  it('states budget and size as ranges, not as brackets', () => {
    // Both halves matter: a floor as well as a roof, so "about fifteen" is
    // expressible, and no fixed band list to go stale as stock changes.
    for (const key of ['estSaleGbp', 'caseSizeMm']) {
      const operators = operatorsFor(field(key)!)
      expect(operators, key).toContain('gt')
      expect(operators, key).toContain('lt')
    }
  })

  it('writes the same clauses the filter menu writes', () => {
    // A control in the bar is a shortcut, not a second kind of filter: it has
    // to survive the same validation or it would be dropped on the way to the
    // query, and the bar would show a filter that was not applied.
    const pairs = [
      { field: 'estSaleGbp', operator: 'gt' as const, values: ['5000'] },
      { field: 'caseSizeMm', operator: 'lt' as const, values: ['41'] },
      { field: 'wears', operator: 'is' as const, values: ['WOMENS'] },
    ]
    for (const clause of pairs) {
      expect(validateClause(clause, WATCH_FIELDS), clause.field).toEqual(clause)
    }
  })

  it('lets a group hold several answers at once', () => {
    // Rolex and Patek together means both, not neither — which is what
    // picking two of anything means everywhere else in this grammar.
    const two = { field: 'brandId', operator: 'is' as const, values: ['a', 'b'] }
    expect(validateClause(two, WATCH_FIELDS)?.values).toHaveLength(2)
  })

  it('reaches the stock list', () => {
    const page = read('src/app/(app)/inventory/page.tsx')
    expect(page).toMatch(/<FindBar facets=\{facets\} total=\{result\.total\} \/>/)
    expect(page).toMatch(/stockFacets\(query\)/)
  })

  it('counts each answer under the others and never under itself', () => {
    // The whole of why this is faceted rather than a list of fixed chips:
    // choosing Rolex renarrows the models while the brand list still offers
    // Patek, because changing your mind is the next thing anybody does.
    const source = read('src/server/repositories/watch-repository.ts')
    expect(source).toMatch(/!fields\.includes\(clause\.field\)/)
    for (const name of ['brandId', 'family', 'estSaleGbp', 'caseSizeMm', 'wears']) {
      expect(source, name).toMatch(new RegExp(`without\\('${name}'\\)`))
    }
  })

  it('survives a case holding one priced watch', () => {
    // A range of zero width divides by zero and draws nothing. It is an
    // ordinary Tuesday, not an edge case worth crashing the page over.
    const source = read('src/server/repositories/watch-repository.ts')
    expect(source).toMatch(/max === min/)
    expect(source).toMatch(/present\.length === 0/)
  })

  it('does not write a bound for a handle nobody moved', () => {
    // "From the cheapest watch upwards" filters nothing, and a chip saying so
    // is a filter the reader has to work out they can ignore.
    const bar = read('src/components/inventory/FindBar.tsx')
    expect(bar).toMatch(/low <= min \? null : low/)
    expect(bar).toMatch(/high >= max \? null : high/)
  })

  it('writes the URL on release, not on every pixel of a drag', () => {
    // A write per pixel refetches the list a hundred times across one drag,
    // and the handles stutter against their own results.
    const bar = read('src/components/inventory/FindBar.tsx')
    expect(bar).toMatch(/if \(!drag\) setLocal/)
    expect(bar).toMatch(/pointerup/)
  })
})

/**
 * A range that includes the numbers on its own handles.
 *
 * Dragging the size slider to 36mm said "under 36mm" and returned no 36mm
 * watch at all — which is the one size the person had just pointed at, and the
 * quietest possible way to be wrong: the list is plausible, and short.
 *
 * The handles of a range control ARE the range. "36mm and under" is also how
 * the question gets asked out loud; nobody browsing for a lady's watch says
 * "under thirty-seven".
 */
describe('the number you stop the handle on', () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

  it('is inside the answer, not just short of it', () => {
    for (const key of ['estSaleGbp', 'caseSizeMm']) {
      const operators = operatorsFor(WATCH_FIELDS.find((spec) => spec.key === key)!)
      expect(operators, key).toContain('gte')
      expect(operators, key).toContain('lte')
      // And the inclusive pair comes first, so a chip added from the menu
      // starts on the one that matches what a slider means.
      expect(operators[0], key).toBe('lte')
    }
    const sql = read('src/server/repositories/filter-sql.ts')
    expect(sql).toMatch(/case 'gte':[\s\S]{0,120}gte\(column/)
    expect(sql).toMatch(/case 'lte':[\s\S]{0,120}lte\(column/)
  })

  it('is what the slider writes', () => {
    const bar = read('src/components/inventory/FindBar.tsx')
    expect(bar).toMatch(/operator: 'gte', values: \[String\(lo\)\]/)
    expect(bar).toMatch(/operator: 'lte', values: \[String\(hi\)\]/)
  })

  it('still reads a link written before the handles were inclusive', () => {
    // `gt` and `lt` are valid filters and people have them in saved views.
    for (const raw of ['caseSizeMm:lt:36', 'estSaleGbp:gt:5000']) {
      expect(parseFilters(`f=${raw}`, WATCH_FIELDS), raw).toHaveLength(1)
    }
    const bar = read('src/components/inventory/FindBar.tsx')
    expect(bar).toMatch(/side === 'lo' \? \['gte', 'gt'\] : \['lte', 'lt'\]/)
  })

  it('says so on the trigger', () => {
    const bar = read('src/components/inventory/FindBar.tsx')
    expect(bar).toMatch(/\$\{format\(hi!\)\} and under/)
    expect(bar).toMatch(/\$\{format\(lo\)\} and over/)
    expect(bar).not.toMatch(/`under \$\{format/)
  })
})

describe('a measurement in a chip', () => {
  it('says what it is measured in', () => {
    // "Case size is up to 31" is a number floating free of what it counts,
    // sitting next to a slider whose own labels read 31mm.
    expect(describeClause({ field: 'caseSizeMm', operator: 'lte', values: ['36'] }, WATCH_FIELDS))
      .toBe('Case size is up to 36mm')
    // And a plain number stays plain: a year is not 2023 of anything.
    expect(describeClause({ field: 'year', operator: 'gte', values: ['2023'] }, WATCH_FIELDS))
      .toBe('Year is from 2023')
  })
})
