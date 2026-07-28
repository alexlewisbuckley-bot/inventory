import ExcelJS from 'exceljs'
import { IMPORT_COLUMNS } from '@/lib/import-columns'

/**
 * The import template as a real spreadsheet.
 *
 * A template beats a paragraph of instructions: the columns are already in the
 * right order with the right names, the example row shows the date and number
 * formats that actually parse, and the required ones are marked so nobody
 * discovers halfway through that Location was compulsory.
 *
 * The example row is deleted by the person filling it in — it exists to be
 * copied and overwritten, which is what people do with templates whatever the
 * instructions say, so it is written to survive that: every value in it is a
 * valid one.
 */
export async function buildImportTemplate(locationNames: string[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Bluecroft Stock'
  workbook.created = new Date(0)

  const sheet = workbook.addWorksheet('Stock', {
    views: [{ state: 'frozen', ySplit: 2 }],
  })

  sheet.columns = IMPORT_COLUMNS.map((column) => ({
    header: column.header,
    key: column.header,
    width: column.width,
  }))

  // Row 1: headers. Row 2: what each column wants. The parser skips row 2
  // because it recognises the hint text, but the person reading it does not
  // have to go looking for a separate instruction sheet.
  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF04173A' } }
  headerRow.alignment = { vertical: 'middle' }
  headerRow.height = 22

  const hintRow = sheet.addRow(
    IMPORT_COLUMNS.map((c) => (c.required ? `Required · ${c.hint}` : `Optional · ${c.hint}`)),
  )
  hintRow.font = { italic: true, size: 9, color: { argb: 'FF51617D' } }
  hintRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F8FC' } }

  const example = sheet.addRow(IMPORT_COLUMNS.map((c) => c.example))
  example.font = { color: { argb: 'FF51617D' } }

  // Text format throughout: Excel helpfully turns 08/04/2026 into a date in the
  // American order and 126711CHNR into nothing at all, and both then arrive
  // back here wrong.
  sheet.eachRow((row) => row.eachCell((cell) => { cell.numFmt = '@' }))

  const notes = workbook.addWorksheet('How to use this')
  notes.columns = [{ width: 22 }, { width: 90 }]
  notes.addRow(['Filling this in', '']).font = { bold: true, size: 12 }
  notes.addRow(['', 'Row 1 is the column headers — leave it exactly as it is.'])
  notes.addRow(['', 'Row 2 explains each column. Delete it, or leave it: the import skips it either way.'])
  notes.addRow(['', 'Row 3 is a worked example. Overwrite it with your first watch, or delete it.'])
  notes.addRow(['', 'One watch per row. Stock numbers are allocated on import, continuing your sequence.'])
  notes.addRow(['', ''])
  notes.addRow(['Locations', '']).font = { bold: true, size: 12 }
  notes.addRow(['', 'A location must already exist. These are yours right now:'])
  notes.addRow(['', locationNames.join('  ·  ')])
  notes.addRow(['', ''])
  notes.addRow(['Brands and suppliers', '']).font = { bold: true, size: 12 }
  notes.addRow(['', 'These are created automatically if the name is new, so spelling matters — '
    + '"Rolex" and "ROLEX " become one brand, but "Rollex" becomes another.'])
  notes.addRow(['', ''])
  notes.addRow(['Nothing is saved until you say so', '']).font = { bold: true, size: 12 }
  notes.addRow(['', 'The import shows you exactly what it will do and lists every problem with its row '
    + 'number before anything is written.'])

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
