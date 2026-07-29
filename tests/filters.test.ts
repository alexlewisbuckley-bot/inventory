import { describe, expect, it } from 'vitest'
import {
  applyFilters, describeClause, describeFilters, encodeClause, operatorsFor,
  parseClause, parseFilters, validateClause, WATCH_FIELDS, CONTACT_FIELDS,
  type FilterClause,
} from '@/lib/filters'

/**
 * The filter grammar.
 *
 * Everything here is a URL somebody could type, paste, edit by hand or receive
 * six months late from a colleague. The grammar's whole job is to survive all
 * four, and the interesting cases are the hostile ones — which is why most of
 * this file is about input nobody would deliberately produce.
 */

const round = (clause: FilterClause) => parseClause(encodeClause(clause), WATCH_FIELDS)

describe('round trip', () => {
  it('survives encode and decode unchanged', () => {
    const cases: FilterClause[] = [
      { field: 'status', operator: 'is', values: ['IN_STOCK', 'RESERVED'] },
      { field: 'purchasePriceGbp', operator: 'gt', values: ['10000'] },
      { field: 'purchaseDate', operator: 'before', values: ['2026-03-01'] },
      { field: 'model', operator: 'contains', values: ['Daytona'] },
      { field: 'serial', operator: 'isEmpty', values: [] },
    ]
    for (const clause of cases) expect(round(clause)).toEqual(clause)
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
    const clause: FilterClause = { field: 'model', operator: 'contains', values: ['GMT-Master II: 1675'] }
    expect(round(clause)).toEqual(clause)
  })
})

describe('hostile input', () => {
  const rejected = [
    ['an unknown field', 'colour:is:blue'],
    ['an unknown operator', 'status:sortOf:IN_STOCK'],
    ['an operator the field does not support', 'status:contains:IN_STOCK'],
    ['an enum value outside the enum', 'status:is:MELTED'],
    ['a number that is not a number', 'purchasePriceGbp:gt:lots'],
    ['a date that is not a date', 'purchaseDate:before:soon'],
    ['a date that looks right and is not', 'purchaseDate:before:2026-13-45'],
    ['a clause with no operator', 'status'],
    ['an empty string', ''],
    ['a leading colon', ':is:IN_STOCK'],
    ['a value that is only whitespace', 'model:contains:   '],
  ] as const

  it.each(rejected)('drops %s', (_name, raw) => {
    expect(parseClause(raw, WATCH_FIELDS)).toBeNull()
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
    const many = Array.from({ length: 60 }, (_, i) => `f=model:contains:term${i}`).join('&')
    expect(parseFilters(many, WATCH_FIELDS).length).toBeLessThanOrEqual(20)

    const values = Array.from({ length: 200 }, (_, i) => `V${i}`).join('|')
    const clause = parseClause(`model:contains:${values}`, WATCH_FIELDS)
    expect(clause?.values.length).toBeLessThanOrEqual(40)
  })

  it('truncates a value nobody could have typed', () => {
    const long = 'x'.repeat(500)
    expect(parseClause(`model:contains:${long}`, WATCH_FIELDS)).toBeNull()
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
    expect(operatorsFor(cost)).toEqual(['gt', 'lt', 'isEmpty', 'isNotEmpty'])

    const serial = WATCH_FIELDS.find((field) => field.key === 'serial')!
    expect(operatorsFor(serial)).toContain('isEmpty')
  })

  it('discards values on an operator that does not take them', () => {
    const clause = validateClause(
      { field: 'serial', operator: 'isEmpty', values: ['ignored'] },
      WATCH_FIELDS,
    )
    expect(clause).toEqual({ field: 'serial', operator: 'isEmpty', values: [] })
  })
})

describe('description', () => {
  it('says what a person would say', () => {
    expect(describeClause({ field: 'status', operator: 'is', values: ['IN_STOCK'] }, WATCH_FIELDS))
      .toBe('Status is In stock')
    expect(describeClause({ field: 'purchasePriceGbp', operator: 'gt', values: ['10000'] }, WATCH_FIELDS))
      .toBe('Cost is over £10,000')
    expect(describeClause({ field: 'serial', operator: 'isEmpty', values: [] }, WATCH_FIELDS))
      .toBe('Serial is empty')
  })

  it('never reads a multi-value clause as a conjunction', () => {
    // "Status is In stock, Reserved" reads as "both", which is the opposite of
    // what it does and would be impossible anyway.
    const said = describeClause(
      { field: 'status', operator: 'is', values: ['IN_STOCK', 'RESERVED', 'SOLD'] },
      WATCH_FIELDS,
    )
    expect(said).toBe('Status is any of In stock, Reserved or Sold')
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
    expect(said).toBe('Status is In stock, and Cost is over £10,000')
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
