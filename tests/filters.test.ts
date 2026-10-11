import { describe, expect, it } from 'vitest'
import {
  applyFilters, describeClause, describeFilters, encodeClause, legacyClauses, operatorsFor,
  parseClause, parseFilters, validateClause, WATCH_FIELDS, CONTACT_FIELDS,
  type FilterClause,
} from '@/lib/filters'
import { HELD_STATUSES, heldByQuery } from '@/components/inventory/views'

/**
 * The filter grammar.
 *
 * Everything here is a URL somebody could type, paste, edit by hand or receive
 * six months late from a colleague. The grammar's whole job is to survive all
 * four, and the interesting cases are the hostile ones — which is why most of
 * this file is about input nobody would deliberately produce.
 */

const round = (clause: FilterClause) => parseClause(encodeClause(clause), WATCH_FIELDS)
/**
 * The grammar's text operators, exercised where text filters still live.
 *
 * A watch no longer has any: `model` and `serial` were filters over the two
 * columns the search box already matches, so they were three taps to do worse
 * than typing, and they went. A contact's company and country remain, and the
 * grammar has to keep handling `contains` for them.
 */
const roundContact = (clause: FilterClause) => parseClause(encodeClause(clause), CONTACT_FIELDS)

describe('round trip', () => {
  it('survives encode and decode unchanged', () => {
    const cases: FilterClause[] = [
      { field: 'status', operator: 'is', values: ['IN_STOCK', 'RESERVED'] },
      { field: 'purchasePriceGbp', operator: 'gt', values: ['10000'] },
      { field: 'purchaseDate', operator: 'before', values: ['2026-03-01'] },
      { field: 'missing', operator: 'is', values: ['OWNER', 'VAT'] },
      { field: 'caseSizeMm', operator: 'lt', values: ['38'] },
      { field: 'estSaleGbp', operator: 'isEmpty', values: [] },
    ]
    for (const clause of cases) expect(round(clause)).toEqual(clause)

    const text: FilterClause = { field: 'company', operator: 'contains', values: ['Watches of'] }
    expect(roundContact(text)).toEqual(text)
  })

  it('survives a whole query string', () => {
    const clauses: FilterClause[] = [
      { field: 'status', operator: 'is', values: ['IN_STOCK'] },
      { field: 'estSaleGbp', operator: 'lt', values: ['20000'] },
    ]
    const params = applyFilters(new URLSearchParams('q=daytona&sort=stockNo'), clauses)
    expect(parseFilters(params, WATCH_FIELDS)).toEqual(clauses)
    // And leaves everything that is not a filter alone.
    expect(params.get('q')).toBe('daytona')
    expect(params.get('sort')).toBe('stockNo')
  })

  it('resets the page whenever the filters change', () => {
    // Page 4 of a narrower result is usually empty, and an empty page reads as
    // "nothing matched" — which is a different and much more alarming claim.
    const params = applyFilters(new URLSearchParams('page=4'), [
      { field: 'status', operator: 'is', values: ['SOLD'] },
    ])
    expect(params.get('page')).toBeNull()
  })

  it('keeps a colon inside a text value', () => {
    // "GMT-Master II: 1675" is a real thing somebody would search for, and
    // splitting on every colon would silently truncate it to "GMT-Master II".
    const clause: FilterClause = { field: 'company', operator: 'contains', values: ['GMT-Master II: 1675'] }
    expect(roundContact(clause)).toEqual(clause)
  })
})

describe('hostile input', () => {
  const rejected = [
    ['an unknown field', 'colour:is:blue'],
    ['an unknown operator', 'status:sortOf:IN_STOCK'],
    ['an operator the field does not support', 'status:contains:IN_STOCK'],
    ['an enum value outside the enum', 'status:is:MELTED'],
    ['a fact the record cannot be missing', 'missing:is:PASSPORT'],
    ['a number that is not a number', 'purchasePriceGbp:gt:lots'],
    ['a date that is not a date', 'purchaseDate:before:soon'],
    ['a date that looks right and is not', 'purchaseDate:before:2026-13-45'],
    ['a clause with no operator', 'status'],
    ['an empty string', ''],
    ['a leading colon', ':is:IN_STOCK'],
    ['a text filter on an object that has none', 'model:contains:Daytona'],
  ] as const

  it.each(rejected)('drops %s', (_name, raw) => {
    expect(parseClause(raw, WATCH_FIELDS)).toBeNull()
  })

  it('drops a value that is only whitespace', () => {
    expect(parseClause('company:contains:   ', CONTACT_FIELDS)).toBeNull()
  })

  it('keeps the good clauses in a query that also contains rubbish', () => {
    // The case that actually happens: a link shared months ago, filtering on a
    // column that has since been renamed. The recipient did nothing wrong and
    // cannot fix it, so the list opens with whatever still makes sense.
    const parsed = parseFilters(
      'f=status:is:IN_STOCK&f=colour:is:blue&f=estSaleGbp:gt:5000',
      WATCH_FIELDS,
    )
    expect(parsed.map((clause) => clause.field)).toEqual(['status', 'estSaleGbp'])
  })

  it('refuses to be used as a database', () => {
    const many = Array.from({ length: 60 }, (_, i) => `f=company:contains:term${i}`).join('&')
    expect(parseFilters(many, CONTACT_FIELDS).length).toBeLessThanOrEqual(20)

    const values = Array.from({ length: 200 }, (_, i) => `V${i}`).join('|')
    const clause = parseClause(`company:contains:${values}`, CONTACT_FIELDS)
    expect(clause?.values.length).toBeLessThanOrEqual(40)
  })

  it('truncates a value nobody could have typed', () => {
    const long = 'x'.repeat(500)
    expect(parseClause(`company:contains:${long}`, CONTACT_FIELDS)).toBeNull()
  })

  it('takes only the first value for a comparison', () => {
    // "over 5,000 or over 9,000" is not a filter anybody means. It is somebody
    // editing a URL by hand, and the first value is the only defensible read.
    const clause = parseClause('purchasePriceGbp:gt:5000|9000', WATCH_FIELDS)
    expect(clause?.values).toEqual(['5000'])
  })

  it('collapses duplicate values', () => {
    // Duplicates change nothing and make the chip claim three things are
    // selected when two are.
    const clause = parseClause('status:is:SOLD|SOLD|IN_STOCK', WATCH_FIELDS)
    expect(clause?.values).toEqual(['SOLD', 'IN_STOCK'])
  })

  it('keeps only the first of two clauses on the same field and operator', () => {
    // Two `status:is` clauses is a double click. Honouring both would AND them
    // together into a result set that is always empty.
    const parsed = parseFilters('f=status:is:SOLD&f=status:is:IN_STOCK', WATCH_FIELDS)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.values).toEqual(['SOLD'])
  })

  it('allows the same field twice under different operators', () => {
    // A range is exactly this: over one number and under another.
    const parsed = parseFilters('f=estSaleGbp:gt:5000&f=estSaleGbp:lt:20000', WATCH_FIELDS)
    expect(parsed).toHaveLength(2)
  })
})

describe('operators', () => {
  it('offers only what the type can answer', () => {
    const status = WATCH_FIELDS.find((field) => field.key === 'status')!
    expect(operatorsFor(status)).toEqual(['is', 'isNot'])

    const cost = WATCH_FIELDS.find((field) => field.key === 'purchasePriceGbp')!
    // "Is empty" belongs on a price: unpriced stock is the most-used filter in
    // the product, and leaving it off would mean keeping `unpricedOnly=true`
    // as a hand-written special case forever.
    //
    // Both an inclusive and a strict pair, and the inclusive one first so a
    // new chip defaults to it. A slider's handles are inclusive bounds — the
    // number you stop on is in the answer — while "cost is over ten thousand"
    // is a sentence somebody means strictly, and every link already written
    // with the strict pair still has to read.
    expect(operatorsFor(cost)).toEqual(['lte', 'gte', 'gt', 'lt', 'isEmpty', 'isNotEmpty'])

    const bought = WATCH_FIELDS.find((field) => field.key === 'purchaseDate')!
    expect(operatorsFor(bought)).toEqual(['after', 'before', 'isEmpty', 'isNotEmpty'])

    // And a watch has no text filter left at all: the search box matches the
    // model, the serial, the nickname, the brand and the stock number in one
    // box, which is strictly more than two `contains` chips could do.
    expect(WATCH_FIELDS.filter((field) => field.type === 'text')).toEqual([])
  })

  it('discards values on an operator that does not take them', () => {
    const clause = validateClause(
      { field: 'estSaleGbp', operator: 'isEmpty', values: ['ignored'] },
      WATCH_FIELDS,
    )
    expect(clause).toEqual({ field: 'estSaleGbp', operator: 'isEmpty', values: [] })
  })
})

describe('description', () => {
  it('says what a person would say', () => {
    expect(describeClause({ field: 'status', operator: 'is', values: ['IN_STOCK'] }, WATCH_FIELDS))
      .toBe('Status is In stock')
    expect(describeClause({ field: 'purchasePriceGbp', operator: 'gt', values: ['10000'] }, WATCH_FIELDS))
      // The symbol of the currency the figures are STORED in, which is all
      // this function can know. It read `£` over amounts that have been
      // dollars since 0018 — a price label stating the wrong currency, which
      // understated every budget on the bar by the exchange rate. Anything
      // drawn where somebody has chosen a display currency converts instead.
      .toBe('Cost is over $10,000')
    expect(describeClause({ field: 'estSaleGbp', operator: 'isEmpty', values: [] }, WATCH_FIELDS))
      .toBe('Retail is empty')
  })

  it('never reads a multi-value clause as a conjunction', () => {
    // "Status is In stock, Reserved" reads as "both", which is the opposite of
    // what it does and would be impossible anyway.
    const said = describeClause(
      { field: 'status', operator: 'is', values: ['IN_STOCK', 'RESERVED', 'SOLD'] },
      WATCH_FIELDS,
    )
    expect(said).toBe('Status is any of In stock, Hold or Sold')
  })

  it('resolves reference values through the caller', () => {
    // Brands and locations are rows, not enums; only the page knows their names.
    const said = describeClause(
      { field: 'locationId', operator: 'is', values: ['loc_1'] },
      WATCH_FIELDS,
      (field, value) => (field === 'locationId' && value === 'loc_1' ? 'The vault' : undefined),
    )
    expect(said).toBe('Location is The vault')
  })

  it('falls back to the raw value when nothing can resolve it', () => {
    const said = describeClause(
      { field: 'brandId', operator: 'is', values: ['brd_missing'] },
      WATCH_FIELDS,
    )
    expect(said).toBe('Brand is brd_missing')
  })

  it('builds a sentence an empty state can use', () => {
    // The point of this string: "nothing matched" is a dead end, and naming
    // the conditions tells the reader which one to relax.
    const said = describeFilters([
      { field: 'status', operator: 'is', values: ['IN_STOCK'] },
      { field: 'purchasePriceGbp', operator: 'gt', values: ['10000'] },
    ], WATCH_FIELDS)
    expect(said).toBe('Status is In stock, and Cost is over $10,000')
    expect(describeFilters([], WATCH_FIELDS)).toBe('')
  })
})

describe('field sets', () => {
  it('gives every object its own vocabulary', () => {
    expect(parseClause('tier:is:VIP', CONTACT_FIELDS)).not.toBeNull()
    // A contact has no status called IN_STOCK, and asking for one is a sign
    // the URL came from the wrong list.
    expect(parseClause('status:is:IN_STOCK', CONTACT_FIELDS)).toBeNull()
    expect(parseClause('tier:is:VIP', WATCH_FIELDS)).toBeNull()
  })

  it('declares options for every enum field', () => {
    for (const fields of [WATCH_FIELDS, CONTACT_FIELDS]) {
      for (const field of fields) {
        if (field.type !== 'enum') continue
        expect(field.options, `${field.key} has no options`).toBeTruthy()
        expect(field.options!.length).toBeGreaterThan(0)
      }
      // A reference field must say where its options come from, or the filter
      // builder has a dropdown it cannot populate.
      for (const field of fields) {
        if (field.type !== 'reference') continue
        expect(field.optionSource, `${field.key} has no option source`).toBeTruthy()
      }
    }
  })

  it('uses unique keys within a set', () => {
    for (const fields of [WATCH_FIELDS, CONTACT_FIELDS]) {
      const keys = fields.map((field) => field.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
})

/**
 * Old links, answered.
 *
 * The grammar replaced a set of named parameters that are still in bookmarks
 * and in messages people sent each other. They failed in two different ways
 * and only one of them was visible: `ownerId` was never read at all, so "View
 * stock" on an owner card showed the whole book; the rest filtered correctly
 * and appeared nowhere on the toolbar, which is arguably worse — a list
 * narrowed for a reason nobody can see or undo.
 */
describe('translating the old query parameters', () => {
  const translate = (query: string) => legacyClauses(new URLSearchParams(query))

  it('reads the owner parameter that used to do nothing', () => {
    const { clauses, keys } = translate('ownerId=own_1')
    expect(keys).toEqual(['ownerId'])
    expect(clauses).toEqual([{ field: 'ownerId', operator: 'is', values: ['own_1'] }])
  })

  it('keeps repeated values together rather than dropping all but one', () => {
    const { clauses } = translate('status=IN_STOCK&status=RESERVED')
    expect(clauses).toEqual([{ field: 'status', operator: 'is', values: ['IN_STOCK', 'RESERVED'] }])
  })

  it('says what unpriced meant, so it can be widened again', () => {
    const { clauses } = translate('unpricedOnly=true')
    expect(clauses).toEqual([{ field: 'estSaleGbp', operator: 'isEmpty', values: [] }])
    // Only the affirmative. `false` is not a filter.
    expect(translate('unpricedOnly=false').clauses).toEqual([])
  })

  it('turns the two date bounds into the two date operators', () => {
    const { clauses } = translate('purchasedFrom=2026-01-01&purchasedTo=2026-06-30')
    expect(clauses).toEqual([
      { field: 'purchaseDate', operator: 'after', values: ['2026-01-01'] },
      { field: 'purchaseDate', operator: 'before', values: ['2026-06-30'] },
    ])
  })

  it('finds nothing in a URL that already speaks the grammar', () => {
    // The redirect is driven off `keys`, so anything returned here for a
    // modern URL would be a redirect loop.
    expect(translate('f=status%3Ais%3ASOLD').keys).toEqual([])
    expect(translate('').keys).toEqual([])
  })

  it('ignores an empty value, which is a cleared control rather than a filter', () => {
    expect(translate('locationId=').keys).toEqual([])
  })

  it('round-trips through the parser it is feeding', () => {
    const { clauses } = translate('status=SOLD&locationId=loc_1')
    const encoded = applyFilters(new URLSearchParams(), clauses)
    expect(parseFilters(encoded, WATCH_FIELDS)).toEqual(clauses)
  })
})

/**
 * The link on an owner, location or supplier card.
 *
 * It sits directly under a count and a value, so it has to produce the list
 * those figures describe. The card counts held stock; a link that also
 * returned sold watches would read as the count being wrong.
 */
describe('the "view stock" link', () => {
  it('asks for held stock belonging to one owner', () => {
    const clauses = parseFilters(new URLSearchParams(heldByQuery('ownerId', 'own_1')), WATCH_FIELDS)
    expect(clauses).toEqual([
      { field: 'status', operator: 'is', values: ['IN_STOCK', 'RESERVED', 'SALE_AGREED'] },
      { field: 'ownerId', operator: 'is', values: ['own_1'] },
    ])
  })

  it('counts the same statuses the cards count', () => {
    // Both are derived from this one list; the test is here so that changing
    // it without changing the cards fails loudly.
    expect(HELD_STATUSES).toEqual(['IN_STOCK', 'RESERVED', 'SALE_AGREED'])
  })
})
