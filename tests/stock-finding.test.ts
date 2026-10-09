import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  HELD_STATUSES, MENS_MIN_MM, MISSING_FACTS, MISSING_FACT_LABELS, WEARS, WEARS_LABELS, WOMENS_MAX_MM,
} from '@/lib/enums'
import { WATCH_FIELDS, operatorsFor, parseFilters, validateClause } from '@/lib/filters'
import { INVENTORY_QUICK_FILTERS, INVENTORY_VIEWS } from '@/components/inventory/views'

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

describe('the quick filters', () => {
  it('writes clauses the grammar already understands', () => {
    // A quick filter is a shortcut, not a second kind of filter: every one of
    // them has to survive the same validation a hand-built chip does, or it
    // would be dropped silently on the way to the query.
    for (const quick of INVENTORY_QUICK_FILTERS) {
      expect(validateClause(quick.clause, WATCH_FIELDS), quick.id).toEqual(quick.clause)
    }
  })

  it('offers both sides and a ladder of budgets', () => {
    const ids = INVENTORY_QUICK_FILTERS.map((quick) => quick.id)
    expect(ids).toContain('womens')
    expect(ids).toContain('mens')
    expect(ids.filter((id) => id.startsWith('under-')).length).toBeGreaterThanOrEqual(3)
  })

  it('states every budget as one ceiling on the retail price', () => {
    // Sharing a field and an operator is what makes the row behave as a
    // choice of one rather than ANDing into the smallest. Two budgets at
    // once is not a thing anybody means.
    const budgets = INVENTORY_QUICK_FILTERS.filter((quick) => quick.id.startsWith('under-'))
    for (const budget of budgets) {
      expect(budget.clause.field).toBe('estSaleGbp')
      expect(budget.clause.operator).toBe('lt')
      expect(Number(budget.clause.values[0])).toBeGreaterThan(0)
    }
    const amounts = budgets.map((budget) => Number(budget.clause.values[0]))
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts)
  })

  it('reaches the stock list', () => {
    // The clauses existing is not the feature; being one tap away is.
    expect(read('src/app/(app)/inventory/page.tsx')).toMatch(/quick=\{INVENTORY_QUICK_FILTERS\}/)
  })
})
