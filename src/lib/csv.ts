/**
 * CSV reading and writing.
 *
 * Pure and dependency-free so it is unit-testable and usable from both the
 * import parser and the export routes — the two must agree on quoting rules or
 * a file this system exports cannot be re-imported.
 */

/**
 * Minimal RFC 4180 parser.
 *
 * Handles quoted fields containing commas and newlines, doubled quotes as an
 * escape, CRLF endings, and the UTF-8 BOM that Excel always writes. Entirely
 * blank lines are dropped rather than yielding empty rows.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  const source = text.replace(/^﻿/, '')

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1 }
        else quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field); field = ''
    } else if (char === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else if (char !== '\r') {
      field += char
    }
  }

  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

/** Quote a value only when it contains a delimiter, quote or newline. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Serialise rows to a CSV document.
 *
 * Prefixed with a BOM so Excel on Windows renders £ and other non-ASCII
 * characters correctly instead of mojibake.
 */
export function toCsv(header: readonly string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))]
  return `﻿${lines.join('\r\n')}`
}
