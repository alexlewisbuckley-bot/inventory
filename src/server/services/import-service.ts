import { and, eq, isNull } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { brands, locations, suppliers, watches, stockMovements } from '../db/schema'
import { recordAudit } from './audit'
import { newId, slugify } from '@/lib/ids'
import { toMinor } from '@/lib/money'
import { logger } from '@/lib/logger'
import { parseCsv } from '@/lib/csv'
import { REQUIRED_HEADERS, normaliseHeader } from '@/lib/import-columns'
import {
  DEFAULT_PRODUCT_TYPE, PRODUCT_TYPES, PRODUCT_TYPE_LABELS, type ProductType,
} from '@/lib/enums'
import type { SessionUser } from '../auth/session'

/**
 * Spreadsheet import for stock.
 *
 * Deliberately two-phase: `parseImport` validates and reports, `commitImport`
 * writes. Anyone bringing in a spreadsheet export needs to see exactly what
 * will happen before anything changes — a half-applied import of 200 watches
 * is far worse than a rejected one.
 *
 * Accepts .xlsx as well as .csv, because the stock list this replaced was a
 * spreadsheet and asking somebody to save-as-CSV first is a step at which
 * people quietly give up.
 */

export interface ImportRow {
  line: number
  stockNo: number | null
  /** Watch unless the sheet says otherwise — see `parseProductType`. */
  productType: ProductType
  brand: string
  model: string
  serial: string | null
  supplier: string
  location: string
  purchaseDate: string
  purchasePriceGbp: number | null
  /** Estimate in GBP minor-unit major form, i.e. pounds. */
  estSaleGbp: number | null
}

export interface ImportIssue {
  line: number
  field: string
  message: string
  severity: 'error' | 'warning'
}

export interface ImportPreview {
  rows: ImportRow[]
  issues: ImportIssue[]
  newBrands: string[]
  newSuppliers: string[]
  unknownLocations: string[]
  validCount: number
  errorCount: number
}

const REQUIRED = REQUIRED_HEADERS.map((h) => normaliseHeader(h))

/**
 * Read a spreadsheet or CSV into a table of strings.
 *
 * Excel is read cell by cell rather than through a CSV round-trip: a date cell
 * comes back as a Date and a price as a number, and stringifying those with
 * the default locale is how "08/04/2026" became "April 8" and then failed to
 * parse. Dates are normalised to ISO here so the row parser sees one shape.
 */
export async function readTable(file: { name: string; buffer: ArrayBuffer }): Promise<string[][]> {
  const isExcel = /\.xlsx?$/i.test(file.name)
  if (!isExcel) {
    return parseCsv(new TextDecoder().decode(file.buffer))
  }

  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(file.buffer)

  // The template ships a second sheet of instructions, so take the first sheet
  // with data rather than whichever one happened to be active on save.
  const sheet = workbook.worksheets.find((w) => w.actualRowCount > 1) ?? workbook.worksheets[0]
  if (!sheet) return []

  const table: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = []
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = cellToText(cell.value)
    })
    for (let i = 0; i < cells.length; i += 1) cells[i] ??= ''
    table.push(cells)
  })
  return table
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    // ISO, because the row parser already understands it and it cannot be
    // misread as day-first or month-first.
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'object') {
    const rich = value as { text?: string; result?: unknown; richText?: Array<{ text: string }> }
    if (typeof rich.text === 'string') return rich.text
    if (Array.isArray(rich.richText)) return rich.richText.map((part) => part.text).join('')
    if (rich.result !== undefined) return cellToText(rich.result)
    return ''
  }
  return String(value)
}

export async function parseImport(input: string | { name: string; buffer: ArrayBuffer }): Promise<ImportPreview> {
  const table = typeof input === 'string' ? parseCsv(input) : await readTable(input)
  // Only needed for sheets still quoting the estimate in dollars.
  const usdRate = Number(process.env.DEFAULT_FX_GBP_USD ?? 1.33)
  const issues: ImportIssue[] = []
  const rows: ImportRow[] = []

  if (table.length < 2) {
    return {
      rows: [], issues: [{ line: 0, field: 'file', message: 'The file has no data rows.', severity: 'error' }],
      newBrands: [], newSuppliers: [], unknownLocations: [], validCount: 0, errorCount: 1,
    }
  }

  const header = table[0]!.map((h) => normaliseHeader(h))
  const index = (name: string): number => header.indexOf(name)
  for (const required of REQUIRED) {
    if (index(required) === -1) {
      issues.push({ line: 1, field: required, message: `Missing required column "${required}".`, severity: 'error' })
    }
  }
  if (issues.length > 0) {
    return { rows: [], issues, newBrands: [], newSuppliers: [], unknownLocations: [], validCount: 0, errorCount: issues.length }
  }

  const [existingBrands, existingSuppliers, existingLocations] = await Promise.all([
    db.select({ name: brands.name }).from(brands),
    db.select({ name: suppliers.name }).from(suppliers).where(isNull(suppliers.deletedAt)),
    db.select({ name: locations.name }).from(locations).where(isNull(locations.deletedAt)),
  ])
  const brandNames = new Set(existingBrands.map((b) => b.name.toLowerCase()))
  const supplierNames = new Set(existingSuppliers.map((s) => s.name.toLowerCase()))
  const locationNames = new Set(existingLocations.map((l) => l.name.toLowerCase()))

  const newBrands = new Set<string>()
  const newSuppliers = new Set<string>()
  const unknownLocations = new Set<string>()
  const seenSerials = new Set<string>()

  for (let r = 1; r < table.length; r += 1) {
    const line = r + 1
    const cells = table[r]!
    const value = (name: string): string => (cells[index(name)] ?? '').trim()

    // The downloaded template carries a row of hints under the headers. People
    // leave it in, so recognise and skip it rather than reporting it as six
    // validation errors on the first row of their file.
    if (cells.some((cell) => /^(Required|Optional)\s·/.test(cell.trim()))) continue
    // A wholly blank row is trailing formatting, not a mistake worth reporting.
    if (cells.every((cell) => cell.trim() === '')) continue

    const rawType = value('type')
    const productType = parseProductType(rawType)
    if (rawType && productType === null) {
      issues.push({
        line, field: 'type',
        message: `Did not recognise the type "${rawType}" — importing it as a watch.`,
        severity: 'warning',
      })
    }

    const brand = value('brand')
    const model = value('reference')
    const supplier = value('supplier')
    const location = value('location')
    const serial = value('serial') || null
    const rawDate = value('purchase date')
    const rawPrice = value('purchase price (gbp)')
    const rawEst = value('est sale (gbp)') || value('est sale (usd)')
    // A sheet written before the change to sterling still says "(USD)". Honour
    // its header rather than reading dollars as pounds.
    const estIsUsd = !value('est sale (gbp)') && Boolean(value('est sale (usd)'))

    let errored = false
    const fail = (field: string, message: string) => {
      issues.push({ line, field, message, severity: 'error' })
      errored = true
    }

    if (!brand) fail('brand', 'Brand is required.')
    if (!model) fail('reference', 'Reference number is required.')
    if (!supplier) fail('supplier', 'Supplier is required.')

    const date = parseDate(rawDate)
    if (!date) fail('purchase date', `Could not read the date "${rawDate}". Use DD/MM/YYYY or YYYY-MM-DD.`)
    else if (date.getTime() > Date.now() + 86_400_000) fail('purchase date', 'Purchase date is in the future.')

    const price = parseAmount(rawPrice)
    if (price === null) fail('purchase price (gbp)', `Could not read the price "${rawPrice}".`)
    else if (price <= 0) fail('purchase price (gbp)', 'Purchase price must be greater than zero.')

    const rawEstAmount = rawEst ? parseAmount(rawEst) : null
    if (rawEst && rawEstAmount === null) {
      issues.push({ line, field: 'est sale', message: `Ignoring unreadable sale price "${rawEst}".`, severity: 'warning' })
    }
    const est = rawEstAmount === null ? null : estIsUsd ? rawEstAmount / usdRate : rawEstAmount
    if (estIsUsd && rawEstAmount !== null) {
      issues.push({
        line, field: 'est sale (usd)',
        message: `Converted $${rawEstAmount} to £${est!.toFixed(2)} at ${usdRate}.`,
        severity: 'warning',
      })
    }

    if (location && !locationNames.has(location.toLowerCase())) {
      unknownLocations.add(location)
      fail('location', `Location "${location}" does not exist. Create it first, or correct the spelling.`)
    }
    if (brand && !brandNames.has(brand.toLowerCase())) newBrands.add(brand)
    if (supplier && !supplierNames.has(supplier.toLowerCase())) newSuppliers.add(supplier)

    if (serial) {
      if (seenSerials.has(serial.toLowerCase())) {
        fail('serial', `Serial "${serial}" appears more than once in this file.`)
      } else {
        seenSerials.add(serial.toLowerCase())
        const clash = await db.select({ stockNo: watches.stockNo }).from(watches)
          .where(and(eq(watches.serial, serial), isNull(watches.deletedAt))).limit(1)
        if (clash[0]) fail('serial', `Serial "${serial}" is already on stock number ${clash[0].stockNo}.`)
      }
    }

    if (!errored) {
      rows.push({
        line, stockNo: null, productType: productType ?? DEFAULT_PRODUCT_TYPE, brand, model, serial,
        supplier, location, purchaseDate: date!.toISOString(),
        purchasePriceGbp: price, estSaleGbp: est,
      })
    }
  }

  return {
    rows,
    issues,
    newBrands: [...newBrands],
    newSuppliers: [...newSuppliers],
    unknownLocations: [...unknownLocations],
    validCount: rows.length,
    errorCount: issues.filter((i) => i.severity === 'error').length,
  }
}

/** Write a previously validated import. All-or-nothing. */
export async function commitImport(rows: ImportRow[], actor: SessionUser): Promise<number> {
  if (rows.length === 0) return 0
  const fx = Number(process.env.DEFAULT_FX_GBP_USD ?? 1.33)

  return withTransaction(async () => {
    const brandIds = new Map<string, string>()
    const supplierIds = new Map<string, string>()
    const locationIds = new Map<string, string>()

    for (const row of rows) {
      if (!brandIds.has(row.brand.toLowerCase())) {
        const slug = slugify(row.brand)
        const found = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, slug)).limit(1)
        if (found[0]) brandIds.set(row.brand.toLowerCase(), found[0].id)
        else {
          const id = newId('brd')
          await db.insert(brands).values({ id, name: row.brand, slug })
          brandIds.set(row.brand.toLowerCase(), id)
        }
      }
      if (!supplierIds.has(row.supplier.toLowerCase())) {
        const found = await db.select({ id: suppliers.id }).from(suppliers)
          .where(eq(suppliers.name, row.supplier)).limit(1)
        if (found[0]) supplierIds.set(row.supplier.toLowerCase(), found[0].id)
        else {
          const id = newId('sup')
          await db.insert(suppliers).values({ id, name: row.supplier })
          supplierIds.set(row.supplier.toLowerCase(), id)
        }
      }
      if (!locationIds.has(row.location.toLowerCase())) {
        const found = await db.select({ id: locations.id }).from(locations)
          .where(eq(locations.slug, slugify(row.location))).limit(1)
        if (!found[0]) throw new Error(`Location "${row.location}" no longer exists.`)
        locationIds.set(row.location.toLowerCase(), found[0].id)
      }
    }

    const highest = await db.select({ max: watches.stockNo }).from(watches)
      .orderBy(watches.stockNo).limit(1)
    let nextStock = Math.max(1399, ...(await db.select({ n: watches.stockNo }).from(watches)).map((r) => r.n)) + 1
    void highest

    for (const row of rows) {
      const id = newId('wch')
      const priceMinor = toMinor(row.purchasePriceGbp!)
      const { gbp: estGbp, usd: estUsd } = estimateFromSheet(row.estSaleGbp, fx)
      const locationId = locationIds.get(row.location.toLowerCase())!
      await db.insert(watches).values({
        id,
        stockNo: nextStock,
        productType: row.productType,
        brandId: brandIds.get(row.brand.toLowerCase())!,
        model: row.model,
        serial: row.serial,
        supplierId: supplierIds.get(row.supplier.toLowerCase())!,
        purchaseDate: new Date(row.purchaseDate),
        purchasePriceGbp: priceMinor,
        purchasePriceUsd: Math.round(priceMinor * fx),
        purchaseFxRate: Math.round(fx * 10_000),
        purchaseAmount: priceMinor,
        purchaseCurrency: 'GBP',
        estSaleUsd: estUsd,
        // The spreadsheet quotes estimates in dollars, but every report
        // aggregates the GBP base. Omitting it made an imported watch count as
        // unpriced no matter what the sheet said.
        estSaleGbp: estGbp,
        estSaleAmount: estGbp,
        estSaleCurrency: 'GBP',
        locationId,
        createdById: actor.id,
      })
      await db.insert(stockMovements).values({
        id: newId('mov'), watchId: id, fromLocationId: null,
        toLocationId: locationId, reason: 'Imported from CSV', movedById: actor.id,
      })
      nextStock += 1
    }

    await recordAudit({
      entityType: 'Watch', entityId: 'bulk', action: 'IMPORT', actorId: actor.id,
      summary: `${rows.length} watches imported from CSV`,
    })
    logger.info('import committed', { count: rows.length, actorId: actor.id })
    return rows.length
  })
}

/**
 * Read the Type column, by code or by label.
 *
 * Returns null for anything unrecognised rather than guessing, so the caller
 * can say so and still import the row as a watch: a misspelt type is not a
 * reason to reject a watch whose price, supplier and date are all correct.
 */
export function parseProductType(raw: string): ProductType | null {
  const cleaned = raw.trim().toLowerCase()
  if (!cleaned) return DEFAULT_PRODUCT_TYPE
  const match = PRODUCT_TYPES.find((type) => (
    type.toLowerCase() === cleaned || PRODUCT_TYPE_LABELS[type].toLowerCase() === cleaned
  ))
  return match ?? null
}

/** Accepts DD/MM/YYYY, YYYY-MM-DD and DD-MM-YYYY. */
function parseDate(raw: string): Date | null {
  if (!raw) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`)
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw)
  if (dmy) {
    const day = Number(dmy[1]); const month = Number(dmy[2])
    if (day > 31 || month > 12) return null
    return new Date(Date.UTC(Number(dmy[3]), month - 1, day))
  }
  return null
}

function parseAmount(raw: string): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[£$,\s]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The estimate as it must be stored.
 *
 * The sheet quotes sterling, which is the base every report aggregates; the
 * dollar figure is derived for the legacy column so historic exports still
 * reconcile. Exported so the null case is covered by a test: a blank estimate
 * has to stay null rather than becoming zero, or the watch reports a total
 * loss instead of appearing on the "needs a price" worklist.
 */
export function estimateFromSheet(
  estSaleGbpMajor: number | null,
  fx: number,
): { gbp: number | null; usd: number | null } {
  if (estSaleGbpMajor === null) return { gbp: null, usd: null }
  const gbp = toMinor(estSaleGbpMajor)
  return { gbp, usd: Math.round(gbp * fx) }
}
