import ExcelJS from 'exceljs'
import { EXCEL_MONEY_FORMATS } from '@/lib/currency'
import type { CurrencyCode } from '@/lib/enums'

/**
 * A column in a downloadable sheet.
 *
 * `kind` decides the cell format, which is set on the column rather than on the
 * cells. That distinction is the whole point of exporting a spreadsheet instead
 * of a CSV: a format living on the column is inherited by whatever is typed
 * into it later, so a figure somebody adds looks like the ones already there. A
 * CSV cannot carry formatting at all — Excel guesses per cell on the way in, so
 * an edited cell comes out as a bare 500 sitting among dollar amounts.
 */
export interface SheetColumn {
  key: string
  header: string
  width: number
  kind?: 'money' | 'date' | 'integer' | 'percent' | 'text'
  /** Greyed, to show that editing it achieves nothing. */
  muted?: boolean
}

/** Build a single-sheet workbook with a styled header and formatted columns. */
export async function buildWorkbook(
  sheetName: string,
  columns: readonly SheetColumn[],
  rows: ReadonlyArray<Record<string, unknown>>,
  currency: CurrencyCode,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Bluecroft Stock'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }))

  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF04173A' } }
  headerRow.alignment = { vertical: 'middle' }
  headerRow.height = 22

  for (const row of rows) sheet.addRow(row)

  const moneyFormat = EXCEL_MONEY_FORMATS[currency]
  for (const column of columns) {
    const target = sheet.getColumn(column.key)
    if (column.kind === 'money') {
      target.numFmt = moneyFormat
      target.alignment = { horizontal: 'right' }
    } else if (column.kind === 'date') {
      target.numFmt = 'dd/mm/yyyy'
    } else if (column.kind === 'integer') {
      target.numFmt = '0'
    } else if (column.kind === 'percent') {
      target.numFmt = '0.00"%"'
      target.alignment = { horizontal: 'right' }
    }
    if (column.muted) target.font = { color: { argb: 'FF8792A6' } }
  }

  // The header is text whatever its column says, or "Purchase Price (USD)"
  // inherits a currency format and Excel renders it oddly.
  headerRow.eachCell((cell) => { cell.numFmt = '@' })
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
