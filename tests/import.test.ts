import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv, csvCell } from '@/lib/csv'
import { diffAgainstStock, estimateFromSheet, parseAmount, parseProductType } from '@/server/services/import-service'
import { CURRENCIES, PRODUCT_TYPES, PRODUCT_TYPE_LABELS } from '@/lib/enums'
import {
  IMPORT_COLUMNS, REQUIRED_HEADERS, REQUIRED_KEYS, WRITABLE_COLUMNS,
  headerFor, headersFor, normaliseHeader, parseHeader,
} from '@/lib/import-columns'

describe('CSV parsing', () => {
  it('parses a plain table', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })

  it('respects quoted fields containing commas', () => {
    expect(parseCsv('name,notes\nRolex,"Box, papers and tag"'))
      .toEqual([['name', 'notes'], ['Rolex', 'Box, papers and tag']])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"He said ""hello"""')).toEqual([['a'], ['He said "hello"']])
  })

  it('strips a UTF-8 BOM, which Excel always writes', () => {
    expect(parseCsv('﻿Stock No,Brand\n1143,Rolex')).toEqual([['Stock No', 'Brand'], ['1143', 'Rolex']])
  })

  it('handles CRLF line endings from Windows', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('drops entirely blank lines rather than emitting empty rows', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('keeps embedded newlines inside quoted fields', () => {
    expect(parseCsv('a\n"line one\nline two"')).toEqual([['a'], ['line one\nline two']])
  })
})

describe('CSV writing', () => {
  it('quotes only the values that need it', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('has, comma')).toBe('"has, comma"')
    expect(csvCell('has "quotes"')).toBe('"has ""quotes"""')
    expect(csvCell(null)).toBe('')
  })

  it('round-trips: anything exported can be imported again', () => {
    const header = ['Model', 'Notes'] as const
    const rows = [['126711CHNR', 'Box, papers and "tag"'], ['116610LV', 'line one\nline two']]
    const parsed = parseCsv(toCsv(header, rows))
    expect(parsed[0]).toEqual(['Model', 'Notes'])
    expect(parsed[1]).toEqual(rows[0])
    expect(parsed[2]).toEqual(rows[1])
  })
})

/**
 * Regression: the importer wrote only the legacy estimate column and left the
 * reporting base null. Every report aggregates the base, so an imported watch
 * with a perfectly good estimate still counted as unpriced — the dashboard told
 * the user to go and price watches the spreadsheet had already priced.
 */
describe('imported estimates reach the reporting base', () => {
  /**
   * Both columns hold the same figure. The estimate is already in the base by
   * the time it gets here and the base is dollars, so a second multiplication
   * put a third onto every imported forecast — which is what this asserted
   * before the base moved.
   */
  it('stores the sheet value in the base and the retained dollar column alike', () => {
    expect(estimateFromSheet(14_980)).toEqual({ gbp: 1_498_000, usd: 1_498_000 })
  })

  it('keeps a missing estimate null rather than turning it into zero', () => {
    // Zero would report the watch as a total loss instead of unpriced.
    expect(estimateFromSheet(null)).toEqual({ gbp: null, usd: null })
  })

  it('never returns a base without a dollar figure, or the reverse', () => {
    for (const value of [0, 1, 18_900]) {
      const result = estimateFromSheet(value)
      expect(result.gbp === null).toBe(result.usd === null)
    }
  })
})

/**
 * The Type column.
 *
 * Optional, because every sheet the business already has predates it and every
 * row in those sheets is a watch. A value nobody can read is a warning and a
 * watch, not a rejected row: the price, supplier and date on that row are
 * still right, and refusing the import over a misspelt word would cost more
 * than the wrong label does.
 */
describe('imported product type', () => {
  it('reads a blank column as a watch', () => {
    expect(parseProductType('')).toBe('WATCH')
    expect(parseProductType('   ')).toBe('WATCH')
  })

  it('accepts either the label or the stored code, in any case', () => {
    expect(parseProductType('Handbag')).toBe('HANDBAG')
    expect(parseProductType('HANDBAG')).toBe('HANDBAG')
    expect(parseProductType('  jewellery ')).toBe('JEWELLERY')
  })

  it('reports anything else rather than guessing at it', () => {
    // The caller turns null into a warning and imports the row as a watch.
    expect(parseProductType('Bracelet')).toBeNull()
    expect(parseProductType('jewelry')).toBeNull()
  })

  it('round-trips every type the system can store', () => {
    for (const type of PRODUCT_TYPES) {
      expect(parseProductType(PRODUCT_TYPE_LABELS[type])).toBe(type)
    }
  })
})

describe('import headers', () => {
  it('still accepts sheets written before Model was renamed to Reference', () => {
    // Every spreadsheet the business already has says "Model". Breaking those
    // would mean the rename silently broke the import for existing files.
    expect(normaliseHeader('Model')).toBe('reference')
    expect(normaliseHeader('  MODEL REFERENCE  ')).toBe('reference')
    expect(normaliseHeader('Reference')).toBe('reference')
  })

  it('accepts the names people give the type column', () => {
    expect(normaliseHeader('Type')).toBe('type')
    expect(normaliseHeader('Product Type')).toBe('type')
    expect(normaliseHeader('Category')).toBe('type')
  })

  it('normalises case and internal spacing, and lifts the currency off', () => {
    // The unit belongs to the figures, not to the column's identity: one
    // "purchase price" column, quoted in whichever currency the header names.
    expect(parseHeader('Purchase   Price (GBP)')).toEqual({ key: 'purchase price', currency: 'GBP' })
    expect(parseHeader('purchase price (aed)')).toEqual({ key: 'purchase price', currency: 'AED' })
    expect(parseHeader('Cost')).toEqual({ key: 'purchase price', currency: null })
    // An old sheet saying "Est Sale" is the Retail column under its old name.
    expect(parseHeader('Est Sale (USD)')).toEqual({ key: 'retail', currency: 'USD' })
  })

  it('does not mistake a bracketed word for a currency', () => {
    expect(parseHeader('Reference (old)')).toEqual({ key: 'reference (old)', currency: null })
  })

  it('leaves an unrecognised header alone rather than guessing', () => {
    expect(normaliseHeader('Movement')).toBe('movement')
  })

  it('keeps the template and the parser in step', () => {
    // The template, the parser and the on-screen guide all read one list. This
    // fails if a column is added to the template without the parser noticing.
    const headers = headersFor('USD')
    expect(headers).toEqual(IMPORT_COLUMNS.map((c) => headerFor(c, 'USD')))
    for (const required of REQUIRED_HEADERS) {
      expect(headers.some((h) => h.startsWith(required))).toBe(true)
    }
  })

  /**
   * The round trip, asserted on the shapes.
   *
   * The export and the template were written as separate lists and drifted two
   * columns apart, so the application produced a file it could not read back.
   * They now come from one list; this is the test that keeps them there, and it
   * checks every currency because the money headers carry the unit.
   */
  it('names its money columns after the reader\'s currency, whichever it is', () => {
    for (const currency of CURRENCIES) {
      const headers = headersFor(currency)
      for (const column of IMPORT_COLUMNS.filter((c) => c.money)) {
        expect(headers, currency).toContain(`${column.label} (${currency})`)
      }
    }
  })

  it('reads every exported money header back, whatever the currency', () => {
    for (const currency of CURRENCIES) {
      for (const column of IMPORT_COLUMNS.filter((c) => c.money)) {
        const header = headerFor(column, currency)
        expect(parseHeader(header), header).toEqual({ key: column.key, currency })
      }
    }
  })

  it('ships an example value for every column somebody must fill in', () => {
    for (const column of IMPORT_COLUMNS.filter((c) => c.required)) {
      expect(column.example.length, column.label).toBeGreaterThan(0)
    }
  })

  /**
   * Profit and status are written by the export and owned by the application.
   * They are listed so the two shapes match, and marked so a sheet cannot set
   * them: a profit typed into a spreadsheet is not a fact about a watch.
   */
  it('exports the derived columns but will not let a sheet set them', () => {
    const derived = IMPORT_COLUMNS.filter((c) => c.derived).map((c) => c.key)
    expect(derived).toEqual(['est profit', 'status'])
    for (const key of derived) {
      expect(WRITABLE_COLUMNS.map((c) => c.key)).not.toContain(key)
      expect(REQUIRED_KEYS).not.toContain(key)
    }
  })

  /**
   * The identity column is the exception, and has to be.
   *
   * A blank stock number is what a new purchase looks like, so the worked
   * example row has to leave it empty — a number there would name a watch the
   * template cannot know exists, and the example row would fail to import on
   * every installation.
   */
  it('leaves the stock number blank in the example row', () => {
    const stockNo = IMPORT_COLUMNS.find((c) => c.key === 'stock no')
    expect(stockNo).toBeDefined()
    expect(stockNo!.required).toBe(false)
    expect(stockNo!.example).toBe('')
  })
})

/**
 * Re-uploading an export.
 *
 * The importer was one-way: every row became a new purchase, and a serial the
 * system already held was rejected as a duplicate — so the natural workflow of
 * exporting, editing a cell and sending it back either failed outright or
 * duplicated the inventory. These cover the rule that makes it work: a row is
 * about a watch, and only what actually differs is a change.
 */
describe('a sheet sent back is matched against stock, not re-added', () => {
  const stored = {
    productType: 'WATCH',
    serial: '1T41F071',
    model: '126711CHNR',
    purchaseDate: new Date('2026-04-08T00:00:00.000Z'),
    purchasePriceGbp: 1_310_551,
    estSaleGbp: 1_498_000,
    brandName: 'Rolex',
    supplierName: 'GB Luxury Limited',
    locationName: 'Own inventory',
    ownerName: 'Bluecroft Traders Limited',
  }
  const EMPTY_SPEC = {
    year: null, caseSizeMm: null, caseMaterial: null, dial: null, bracelet: null,
    movement: null, waterResistanceM: null, condition: null, boxPapers: null,
    description: null,
  }
  const sheet = {
    spec: EMPTY_SPEC,
    productType: 'WATCH' as const,
    brand: 'Rolex',
    model: '126711CHNR',
    serial: '1T41F071',
    supplier: 'GB Luxury Limited',
    location: 'Own inventory',
    owner: 'Bluecroft Traders Limited',
    purchaseDate: '2026-04-08T00:00:00.000Z',
    purchasePriceGbp: 13_105.51,
    estSaleGbp: 14_980,
  }
  const ALL = { serial: true, owner: true, retail: true, type: true }

  it('reports nothing to do when the row is the record', () => {
    expect(diffAgainstStock(stored, sheet, ALL)).toEqual([])
  })

  it('reports only the field that actually moved', () => {
    const changes = diffAgainstStock(stored, { ...sheet, estSaleGbp: 16_500 }, ALL)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ field: 'retail', from: '14980.00', to: '16500.00' })
  })

  it('does not mistake a re-formatted date for an edit', () => {
    // The export writes a plain day; the record carries a timestamp. Comparing
    // them as written would make every row an update.
    expect(diffAgainstStock(stored, { ...sheet, purchaseDate: '2026-04-08' }, ALL)).toEqual([])
  })

  it('ignores case and stray spacing in the reference data', () => {
    const changes = diffAgainstStock(stored, { ...sheet, brand: ' rolex ', supplier: 'GB LUXURY LIMITED' }, ALL)
    expect(changes).toEqual([])
  })

  /**
   * The destructive case. Someone deletes a column they do not care about and
   * sends the sheet back; without this, that reads as "clear this field on
   * every watch" and the confirmation dialog says so far too quietly.
   */
  it('leaves a field alone when the sheet has no column for it', () => {
    const withoutRetail = { ...sheet, estSaleGbp: null, owner: null }
    expect(diffAgainstStock(stored, withoutRetail, { serial: true, owner: false, retail: false, type: true }))
      .toEqual([])
  })

  it('still clears a retail price when the column is there and the cell is empty', () => {
    const changes = diffAgainstStock(stored, { ...sheet, estSaleGbp: null }, ALL)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ field: 'retail', to: '—' })
  })

  it('treats a blank owner cell as unstated rather than as unassigning', () => {
    expect(diffAgainstStock(stored, { ...sheet, owner: null }, ALL)).toEqual([])
  })
})

/**
 * Money cells, as the export actually writes them.
 *
 * Figures are exported formatted, because a column of bare numbers is what
 * somebody reconciles against and gets wrong. The parser then has to read that
 * formatting back. It handled only the pound and dollar signs, so an export by
 * anyone reading in dirhams or Hong Kong dollars failed on every row — a file
 * the application had just produced.
 */
describe('a formatted money cell survives the round trip', () => {
  const cases: Array<[string, number | null]> = [
    ['$9,631.56', 9631.56],
    ['AED 35,340.12', 35340.12],
    ['HK$1,200.00', 1200],
    ['£9,631.56', 9631.56],
    ['USD 13,105.51', 13105.51],
    ['13105.51', 13105.51],
    ['1,498,000', 1498000],
    // Accountants write a loss in brackets.
    ['($568.44)', -568.44],
    ['', null],
    ['about ten grand', null],
  ]

  for (const [input, expected] of cases) {
    it(`reads ${input === '' ? '(blank)' : input}`, () => {
      expect(parseAmount(input)).toBe(expected)
    })
  }
})
