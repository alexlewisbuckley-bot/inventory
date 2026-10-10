import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUDGET_BANDS, HELD_STATUSES, MENS_MIN_MM, MISSING_FACTS, MISSING_FACT_LABELS,
  SIZE_BANDS, WEARS, WEARS_LABELS, WOMENS_MAX_MM,
} from '@/lib/enums'
import { WATCH_FIELDS, budgetBandLabel, operatorsFor, parseFilters, validateClause } from '@/lib/filters'
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
   * The bar this replaced was six pills: two genders and four budget
   * ceilings. It answered none of the questions a dealer is actually asked —
   * "have you got a Daytona?" was unanswerable from it — and "up to £50,000"
   * matched nearly everything in the book, which makes it a label rather than
   * a filter.
   *
   * The counting itself needs a database and was checked against one: every
   * facet count equalled the length of the list that option opens, and
   * choosing a brand renarrowed the models while leaving the other brands
   * reachable. What is kept here is everything provable without one.
   */
  const field = (key: string) => WATCH_FIELDS.find((spec) => spec.key === key)

  it('asks the four questions a customer actually asks', () => {
    for (const key of ['brandId', 'family', 'budget', 'size']) {
      expect(field(key), key).toBeDefined()
    }
  })

  it('treats a model family as an open list, not a closed one', () => {
    // The distinction is load-bearing. An enum's values are checked against a
    // fixed list; a family name is whatever is in the case this morning.
    // Declared as an enum it passed every check and then had all its values
    // stripped on the way to the query, so the filter silently returned the
    // whole book — caught by comparing each facet count against its own list.
    const family = field('family')!
    expect(family.type).toBe('reference')
    expect(family.optionSource).toBe('families')
    const clause = { field: 'family', operator: 'is' as const, values: ['Submariner'] }
    expect(validateClause(clause, WATCH_FIELDS)).toEqual(clause)
  })

  it('states a budget as a band, never as a ceiling', () => {
    // "Up to £50,000" is not a filter, it is a label: it matches nearly the
    // whole case. What a customer says is "about ten", which has a floor.
    for (const band of BUDGET_BANDS) {
      expect(band.min, band.value).toBeTypeOf('number')
    }
    expect(BUDGET_BANDS.some((band) => band.min > 0)).toBe(true)
    // Open at the top, or the dearest watch in the book falls out of every
    // band the day a dearer one arrives.
    expect(BUDGET_BANDS[BUDGET_BANDS.length - 1]!.max).toBeNull()
  })

  it('leaves no gap and no overlap between bands', () => {
    // A watch in two bands is counted twice and a watch in none is invisible.
    for (const bands of [BUDGET_BANDS, SIZE_BANDS]) {
      for (let i = 1; i < bands.length; i++) {
        expect(bands[i]!.min).toBe(bands[i - 1]!.max)
      }
    }
  })

  it('names a budget in round thousands rather than in exchange rates', () => {
    // A band is a bracket to think in. One that moved with the rate would
    // stop being one, so this is deliberately not in the reader's currency.
    expect(budgetBandLabel({ min: 0, max: 5000 })).toBe('Under £5k')
    expect(budgetBandLabel({ min: 5000, max: 10000 })).toBe('£5k–£10k')
    expect(budgetBandLabel({ min: 50000, max: null })).toBe('£50k+')
  })

  it('writes the same clauses the filter menu writes', () => {
    // A facet chip is a shortcut, not a second kind of filter: it has to
    // survive the same validation, or it would be dropped on the way to the
    // query and the bar would show a filter that was not applied.
    for (const [key, value] of [
      ['budget', BUDGET_BANDS[1]!.value], ['size', SIZE_BANDS[0]!.value], ['wears', 'WOMENS'],
    ] as const) {
      const clause = { field: key, operator: 'is' as const, values: [value] }
      expect(validateClause(clause, WATCH_FIELDS), key).toEqual(clause)
    }
  })

  it('lets a group hold several answers at once', () => {
    // Rolex and Patek together means both, not neither — which is what
    // picking two of anything means everywhere else in this grammar, and
    // what the faceted counts above already assume.
    for (const key of ['brandId', 'family', 'budget', 'size']) {
      expect(operatorsFor(field(key)!), key).toContain('is')
    }
    const two = { field: 'budget', operator: 'is' as const, values: ['U5K', '5_10K'] }
    expect(validateClause(two, WATCH_FIELDS)?.values).toHaveLength(2)
  })

  it('reaches the stock list', () => {
    const page = read('src/app/(app)/inventory/page.tsx')
    expect(page).toMatch(/<StockFacets groups=\{facets\} \/>/)
    expect(page).toMatch(/stockFacets\(query\)/)
  })

  it('hides a group that cannot be switched off', () => {
    // One option is not a filter, it is a label that costs a row — the rule
    // the storefront learned and this borrows.
    const source = read('src/server/repositories/watch-repository.ts')
    expect(source).toMatch(/WORTH_SHOWING = 2/)
    expect(source).toMatch(/options\.length >= WORTH_SHOWING/)
  })

  it('counts each group under the others and never under itself', () => {
    // The whole of why this is faceted rather than a list of fixed chips.
    const source = read('src/server/repositories/watch-repository.ts')
    expect(source).toMatch(/clause\.field !== field/)
    for (const field of ['brandId', 'family', 'budget', 'size', 'wears']) {
      expect(source, field).toMatch(new RegExp(`without\\('${field}'\\)`))
    }
  })
})
