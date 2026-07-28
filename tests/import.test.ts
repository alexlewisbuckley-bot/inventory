import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv, csvCell } from '@/lib/csv'

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
