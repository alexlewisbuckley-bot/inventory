import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv, csvCell } from '@/lib/csv'
import { estimateFromSheet } from '@/server/services/import-service'
import {
  IMPORT_COLUMNS, REQUIRED_HEADERS, normaliseHeader, templateCsv,
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
  it('stores the sheet value as the base and derives the legacy dollar figure', () => {
    expect(estimateFromSheet(14_980, 1.33)).toEqual({ gbp: 1_498_000, usd: 1_992_340 })
  })

  it('keeps a missing estimate null rather than turning it into zero', () => {
    // Zero would report the watch as a total loss instead of unpriced.
    expect(estimateFromSheet(null, 1.33)).toEqual({ gbp: null, usd: null })
  })

  it('never returns a base without a dollar figure, or the reverse', () => {
    for (const value of [0, 1, 18_900]) {
      const result = estimateFromSheet(value, 1.33)
      expect(result.gbp === null).toBe(result.usd === null)
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

  it('normalises case and internal spacing', () => {
    expect(normaliseHeader('Purchase   Price (GBP)')).toBe('purchase price (gbp)')
  })

  it('leaves an unrecognised header alone rather than guessing', () => {
    expect(normaliseHeader('Movement')).toBe('movement')
  })

  it('keeps the template and the parser in step', () => {
    // The template, the parser and the on-screen guide all read one list. This
    // fails if a column is added to the template without the parser noticing.
    const headers = templateCsv().split('\n')[0].split(',')
    expect(headers).toEqual(IMPORT_COLUMNS.map((column) => column.header))
    for (const required of REQUIRED_HEADERS) {
      expect(headers).toContain(required)
    }
  })

  it('ships an example value for every column, so the template parses as-is', () => {
    for (const column of IMPORT_COLUMNS) {
      expect(column.example.length).toBeGreaterThan(0)
    }
  })
})
