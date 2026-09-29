import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { brands, locations, owners, suppliers, watches, stockMovements } from '../db/schema'
import { recordAudit } from './audit'
import { newId, slugify } from '@/lib/ids'
import { toMinor } from '@/lib/money'
import { logger } from '@/lib/logger'
import { parseCsv } from '@/lib/csv'
import { REQUIRED_KEYS, parseHeader } from '@/lib/import-columns'
import { RATE_SCALE, type RateTable } from '@/lib/currency'
import { getRateTable } from './fx-service'
import {
  BASE_CURRENCY, BOX_PAPERS_LABELS, CONDITION_LABELS, CURRENCIES,
  DEFAULT_PRODUCT_TYPE, PRODUCT_TYPES, PRODUCT_TYPE_LABELS,
  type CurrencyCode, type ProductType,
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

/**
 * What the importer proposes to do with one row.
 *
 * CREATE is a purchase the system has not seen. UPDATE is a row that matched an
 * existing watch and differs from it. UNCHANGED matched and is identical, which
 * is the usual verdict for most of a re-uploaded export and must not be written
 * or counted as work.
 */
export type ImportAction = 'CREATE' | 'UPDATE' | 'UNCHANGED'

/** One field the sheet would change, in the words the user reads on screen. */
export interface ImportChange {
  field: string
  label: string
  from: string
  to: string
}

export interface ImportRow {
  line: number
  /** Set when the row matched existing stock — the watch this row is about. */
  watchId: string | null
  stockNo: number | null
  action: ImportAction
  /** Populated for UPDATE rows: exactly what would change, and from what. */
  changes: ImportChange[]
  /** Watch unless the sheet says otherwise — see `parseProductType`. */
  productType: ProductType
  brand: string
  model: string
  serial: string | null
  supplier: string
  location: string
  owner: string | null
  purchaseDate: string
  purchasePriceGbp: number | null
  /** Retail estimate in base major units. */
  estSaleGbp: number | null
  /** The specification, as far as the sheet fills it in. */
  spec: WatchSpec
}

/** What a watch is, as a sheet can describe it. */
export interface WatchSpec {
  year: number | null
  caseSizeMm: number | null
  caseMaterial: string | null
  dial: string | null
  bracelet: string | null
  movement: string | null
  waterResistanceM: number | null
  condition: string | null
  boxPapers: string | null
  description: string | null
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
  unknownOwners: string[]
  validCount: number
  errorCount: number
  createCount: number
  updateCount: number
  unchangedCount: number
}

const REQUIRED = REQUIRED_KEYS

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

/**
 * Convert a major-unit figure quoted in `currency` into the base.
 *
 * The rate comes from the managed table, so an imported sheet converts at the
 * same rate a typed-in purchase does. A currency with no rate is left as it
 * stands rather than multiplied by a guess: a figure in the wrong unit is
 * recoverable, a figure silently scaled by a made-up rate is not.
 */
function converter(rates: RateTable) {
  return (major: number, currency: CurrencyCode): number => {
    if (currency === BASE_CURRENCY) return major
    const rate = rates[currency]
    if (!rate) return major
    return (major * RATE_SCALE) / rate
  }
}

/** The shape a preview returns when nothing could be read from the file. */
/**
 * What a sheet row would change about the watch it matched.
 *
 * Compared in the same units the row will eventually be written in, and with
 * the same tolerance the screens display at: money to the minor unit, dates to
 * the day. Comparing a formatted date string or a float would make a row that
 * changes nothing look like an edit, and an import that claims to change
 * twenty-eight watches when it changes one is an import nobody will confirm.
 */
export function diffAgainstStock(
  existing: {
    productType: string
    serial: string | null
    model: string
    year?: number | null
    caseSizeMm?: number | null
    caseMaterial?: string | null
    dial?: string | null
    bracelet?: string | null
    movement?: string | null
    waterResistanceM?: number | null
    condition?: string | null
    boxPapers?: string | null
    description?: string | null
    purchaseDate: Date
    purchasePriceGbp: number
    estSaleGbp: number | null
    brandName: string
    supplierName: string
    locationName: string
    ownerName: string | null
  },
  proposed: {
    productType: ProductType
    brand: string
    model: string
    serial: string | null
    supplier: string
    location: string
    owner: string | null
    purchaseDate: string
    purchasePriceGbp: number | null
    estSaleGbp: number | null
    spec: WatchSpec
  },
  /**
   * Which optional columns the sheet actually has.
   *
   * A column that is not in the file is a question the sheet does not answer,
   * so the stored value stands. Without this, deleting the Retail column from
   * an export and sending it back would read as "clear the retail price on
   * every watch" — a destructive edit nobody asked for, presented as an
   * update to the one row they did change.
   */
  present: { serial: boolean; owner: boolean; retail: boolean; type: boolean },
): ImportChange[] {
  const changes: ImportChange[] = []
  const add = (field: string, label: string, from: string, to: string) =>
    changes.push({ field, label, from, to })

  const sameText = (a: string | null, b: string | null) =>
    (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

  if (!sameText(existing.brandName, proposed.brand)) {
    add('brand', 'Brand', existing.brandName, proposed.brand)
  }
  if (!sameText(existing.model, proposed.model)) {
    add('reference', 'Reference', existing.model, proposed.model)
  }
  if (present.serial && !sameText(existing.serial, proposed.serial)) {
    add('serial', 'Serial', existing.serial ?? '—', proposed.serial ?? '—')
  }
  if (present.type && existing.productType !== proposed.productType) {
    add('type', 'Type', PRODUCT_TYPE_LABELS[existing.productType as ProductType] ?? existing.productType,
      PRODUCT_TYPE_LABELS[proposed.productType])
  }
  if (!sameText(existing.supplierName, proposed.supplier)) {
    add('supplier', 'Supplier', existing.supplierName, proposed.supplier)
  }
  if (!sameText(existing.locationName, proposed.location)) {
    add('location', 'Location', existing.locationName, proposed.location)
  }
  // A blank owner column is "not stated", not "clear the owner". Somebody who
  // deletes the column, or exports before assigning owners, must not have the
  // register wiped by an import they thought was about a price.
  if (present.owner && proposed.owner !== null && !sameText(existing.ownerName, proposed.owner)) {
    add('owner', 'Owner', existing.ownerName ?? 'Unassigned', proposed.owner)
  }

  // Specification. A blank cell is "not stated" rather than "clear it": these
  // columns are filled in a few at a time, over weeks, and a sheet sent back
  // with half of them still empty must not wipe the half already done.
  const specFields: Array<[keyof typeof proposed.spec, string]> = [
    ['year', 'Year'], ['caseSizeMm', 'Case size'], ['caseMaterial', 'Case material'],
    ['dial', 'Dial'], ['bracelet', 'Bracelet'], ['movement', 'Movement'],
    ['waterResistanceM', 'Water resistance'], ['condition', 'Condition'],
    ['boxPapers', 'Box & papers'], ['description', 'Description'],
  ]
  for (const [field, label] of specFields) {
    const want = proposed.spec[field]
    if (want === null || want === undefined) continue
    const have = (existing as unknown as Record<string, unknown>)[field] ?? null
    const same = typeof want === 'string' && typeof have === 'string'
      ? sameText(have, want)
      : String(have ?? '') === String(want)
    if (!same) add(field.toString(), label, String(have ?? '—'), String(want))
  }

  const existingDay = existing.purchaseDate.toISOString().slice(0, 10)
  const proposedDay = proposed.purchaseDate.slice(0, 10)
  if (existingDay !== proposedDay) {
    add('purchase date', 'Purchase date', existingDay, proposedDay)
  }

  const proposedCost = proposed.purchasePriceGbp === null ? null : toMinor(proposed.purchasePriceGbp)
  if (proposedCost !== null && proposedCost !== existing.purchasePriceGbp) {
    add('purchase price', 'Purchase price',
      majorString(existing.purchasePriceGbp), majorString(proposedCost))
  }

  const proposedRetail = proposed.estSaleGbp === null ? null : toMinor(proposed.estSaleGbp)
  if (present.retail && proposedRetail !== existing.estSaleGbp) {
    add('retail', 'Retail', majorString(existing.estSaleGbp), majorString(proposedRetail))
  }

  return changes
}

/** Minor units as a plain decimal, for the before/after shown in the preview. */
function majorString(minor: number | null): string {
  return minor === null ? '—' : (minor / 100).toFixed(2)
}

const emptyCounts = () => ({
  newBrands: [] as string[], newSuppliers: [] as string[],
  unknownLocations: [] as string[], unknownOwners: [] as string[],
  validCount: 0, errorCount: 0, createCount: 0, updateCount: 0, unchangedCount: 0,
})

export async function parseImport(input: string | { name: string; buffer: ArrayBuffer }): Promise<ImportPreview> {
  const table = typeof input === 'string' ? parseCsv(input) : await readTable(input)
  // Rates come from the managed table so an import converts at exactly the rate
  // the rest of the application does.
  const intoBase = converter(await getRateTable())
  const issues: ImportIssue[] = []
  const rows: ImportRow[] = []

  if (table.length < 2) {
    return {
      rows: [], issues: [{ line: 0, field: 'file', message: 'The file has no data rows.', severity: 'error' }],
      ...emptyCounts(), errorCount: 1,
    }
  }

  // Each header gives a key and, for a money column, the currency its figures
  // are quoted in. Taking the currency off the header is what lets a sheet
  // exported by somebody reading in dirhams come home and be understood.
  const parsed = table[0]!.map((h) => parseHeader(h))
  const header = parsed.map((h) => h.key)
  const index = (name: string): number => header.indexOf(name)
  const currencyOf = (name: string): CurrencyCode => {
    const at = index(name)
    return (at === -1 ? null : parsed[at]!.currency) ?? BASE_CURRENCY
  }
  const priceCurrency = currencyOf('purchase price')
  const retailCurrency = currencyOf('retail')
  const present = {
    serial: index('serial') !== -1,
    owner: index('owner') !== -1,
    retail: index('retail') !== -1,
    type: index('type') !== -1,
  }
  for (const required of REQUIRED) {
    if (index(required) === -1) {
      issues.push({ line: 1, field: required, message: `Missing required column "${required}".`, severity: 'error' })
    }
  }
  if (issues.length > 0) {
    return { rows: [], issues, ...emptyCounts(), errorCount: issues.length }
  }

  const [existingBrands, existingSuppliers, existingLocations, existingOwners, existingStock] =
    await Promise.all([
      db.select({ name: brands.name }).from(brands),
      db.select({ name: suppliers.name }).from(suppliers).where(isNull(suppliers.deletedAt)),
      db.select({ name: locations.name }).from(locations).where(isNull(locations.deletedAt)),
      db.select({ name: owners.name }).from(owners).where(isNull(owners.deletedAt)),
      // Every live watch, with the fields a sheet is allowed to change. Loaded
      // once rather than queried per row: an import is a few hundred rows and
      // a round trip each would make the preview take longer than the upload.
      db.select({
        id: watches.id,
        stockNo: watches.stockNo,
        productType: watches.productType,
        serial: watches.serial,
        model: watches.model,
        purchaseDate: watches.purchaseDate,
        purchasePriceGbp: watches.purchasePriceGbp,
        estSaleGbp: watches.estSaleGbp,
        year: watches.year,
        caseSizeMm: watches.caseSizeMm,
        caseMaterial: watches.caseMaterial,
        dial: watches.dial,
        bracelet: watches.bracelet,
        movement: watches.movement,
        waterResistanceM: watches.waterResistanceM,
        // Loaded because it is compared. A field the diff checks but does not
        // fetch reads as "changed" on every row, which turns a one-cell edit
        // into an import that claims to rewrite the whole book.
        condition: watches.condition,
        boxPapers: watches.boxPapers,
        description: watches.description,
        brandName: brands.name,
        supplierName: suppliers.name,
        locationName: locations.name,
        ownerName: owners.name,
      })
        .from(watches)
        .innerJoin(brands, eq(brands.id, watches.brandId))
        .innerJoin(suppliers, eq(suppliers.id, watches.supplierId))
        .innerJoin(locations, eq(locations.id, watches.locationId))
        .leftJoin(owners, eq(owners.id, watches.ownerId))
        .where(isNull(watches.deletedAt)),
    ])
  const brandNames = new Set(existingBrands.map((b) => b.name.toLowerCase()))
  const supplierNames = new Set(existingSuppliers.map((s) => s.name.toLowerCase()))
  const locationNames = new Set(existingLocations.map((l) => l.name.toLowerCase()))
  const ownerNames = new Set(existingOwners.map((o) => o.name.toLowerCase()))
  const byStockNo = new Map(existingStock.map((w) => [w.stockNo, w]))
  const bySerial = new Map(
    existingStock.filter((w) => w.serial).map((w) => [w.serial!.toLowerCase(), w]),
  )

  const newBrands = new Set<string>()
  const newSuppliers = new Set<string>()
  const unknownLocations = new Set<string>()
  const unknownOwners = new Set<string>()
  const seenSerials = new Set<string>()
  const seenStockNos = new Set<number>()

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
    const owner = value('owner') || null
    const serial = value('serial') || null
    const rawStockNo = value('stock no')
    const stockNo = rawStockNo ? Number(rawStockNo.replace(/[^0-9]/g, '')) : null
    const rawDate = value('purchase date')
    // Dollars are the base now, so a "(USD)" column is read as it stands and a
    // "(GBP)" one is converted. Reading an old sheet's sterling as dollars
    // would understate every purchase by a third, silently, which is exactly
    // the mistake a header exists to prevent.
    const rawPrice = value('purchase price')
    const rawEst = value('retail')

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

    const rawPriceAmount = parseAmount(rawPrice)
    const price = rawPriceAmount === null ? null : intoBase(rawPriceAmount, priceCurrency)
    if (price === null) fail('purchase price', `Could not read the price "${rawPrice}".`)
    else if (price <= 0) fail('purchase price', 'Purchase price must be greater than zero.')

    const rawEstAmount = rawEst ? parseAmount(rawEst) : null
    if (rawEst && rawEstAmount === null) {
      issues.push({ line, field: 'retail', message: `Ignoring unreadable retail price "${rawEst}".`, severity: 'warning' })
    }
    const est = rawEstAmount === null ? null : intoBase(rawEstAmount, retailCurrency)

    if (location && !locationNames.has(location.toLowerCase())) {
      unknownLocations.add(location)
      fail('location', `Location "${location}" does not exist. Create it first, or correct the spelling.`)
    }
    if (brand && !brandNames.has(brand.toLowerCase())) newBrands.add(brand)
    if (supplier && !supplierNames.has(supplier.toLowerCase())) newSuppliers.add(supplier)

    if (owner && !ownerNames.has(owner.toLowerCase())) {
      unknownOwners.add(owner)
      fail('owner', `Owner "${owner}" does not exist. Create it first, or correct the spelling.`)
    }

    // Which watch is this row about?
    //
    // The stock number is the identity the export carries, so it wins. A serial
    // is the fallback for a sheet typed by hand. Without either, the row is a
    // new purchase.
    if (stockNo !== null && Number.isNaN(stockNo)) {
      fail('stock no', `Could not read the stock number "${rawStockNo}".`)
    }
    const matched = stockNo !== null && !Number.isNaN(stockNo)
      ? byStockNo.get(stockNo) ?? null
      : serial ? bySerial.get(serial.toLowerCase()) ?? null : null

    if (stockNo !== null && !Number.isNaN(stockNo)) {
      if (seenStockNos.has(stockNo)) {
        fail('stock no', `Stock number ${stockNo} appears more than once in this file.`)
      } else {
        seenStockNos.add(stockNo)
      }
      if (!matched) {
        fail('stock no', `Stock number ${stockNo} is not in the inventory. Clear the cell to book it in as new.`)
      }
    }

    if (serial) {
      if (seenSerials.has(serial.toLowerCase())) {
        fail('serial', `Serial "${serial}" appears more than once in this file.`)
      } else {
        seenSerials.add(serial.toLowerCase())
        // A serial already held by the very watch this row is about is the
        // normal case for a re-uploaded export, not a duplicate. Only a serial
        // belonging to a *different* watch is a clash. Rejecting the first case
        // is what made an exported sheet impossible to send back.
        const holder = bySerial.get(serial.toLowerCase())
        if (holder && holder.id !== matched?.id) {
          fail('serial', `Serial "${serial}" is already on stock number ${holder.stockNo}.`)
        }
      }
    }

    const whole = (name: string): number | null => {
      const raw = value(name)
      if (!raw) return null
      const parsed = Number(raw.replace(/[^0-9.]/g, ''))
      return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
    }
    const spec: WatchSpec = {
      year: whole('year'),
      caseSizeMm: whole('case size'),
      caseMaterial: value('case material') || null,
      dial: value('dial') || null,
      bracelet: value('bracelet') || null,
      movement: value('movement') || null,
      waterResistanceM: whole('water resistance'),
      condition: matchLabel(value('condition'), CONDITION_LABELS),
      boxPapers: matchLabel(value('box papers'), BOX_PAPERS_LABELS),
      description: value('description') || null,
    }

    if (!errored) {
      const proposed = {
        productType: productType ?? DEFAULT_PRODUCT_TYPE,
        brand, model, serial, supplier, location, owner,
        purchaseDate: date!.toISOString(),
        purchasePriceGbp: price, estSaleGbp: est,
        spec,
      }
      const changes = matched ? diffAgainstStock(matched, proposed, present) : []
      const action: ImportAction = !matched ? 'CREATE' : changes.length > 0 ? 'UPDATE' : 'UNCHANGED'

      rows.push({
        line,
        watchId: matched?.id ?? null,
        stockNo: matched?.stockNo ?? null,
        action,
        changes,
        ...proposed,
      })
    }
  }

  // Said once about the file rather than once per row. A sheet quoted in
  // dirhams is a fact about the sheet, and twenty-eight identical warnings on
  // an import that changes nothing buries the one row that does.
  for (const currency of new Set([priceCurrency, retailCurrency])) {
    if (currency === BASE_CURRENCY) continue
    issues.push({
      line: 1,
      field: 'file',
      message: `Figures are quoted in ${currency} and were converted to ${BASE_CURRENCY} at the managed rate.`,
      severity: 'warning',
    })
  }

  return {
    rows,
    issues,
    newBrands: [...newBrands],
    newSuppliers: [...newSuppliers],
    unknownLocations: [...unknownLocations],
    unknownOwners: [...unknownOwners],
    validCount: rows.length,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    createCount: rows.filter((r) => r.action === 'CREATE').length,
    updateCount: rows.filter((r) => r.action === 'UPDATE').length,
    unchangedCount: rows.filter((r) => r.action === 'UNCHANGED').length,
  }
}

export interface ImportResult {
  created: number
  updated: number
  skipped: number
}

/**
 * Write a previously validated import. All-or-nothing.
 *
 * Rows that matched existing stock and differ are updated in place; rows that
 * matched and are identical are skipped, so re-uploading an export is a no-op
 * rather than twenty-eight duplicate purchases.
 *
 * Known limit: the diff carried on each row was computed when the file was
 * checked, not now. If somebody edits a watch between the preview and the
 * confirmation, the sheet still wins. Re-deriving the diff inside this
 * transaction would close that window and is the right fix if imports ever
 * become something two people do at once.
 */
export async function commitImport(rows: ImportRow[], actor: SessionUser): Promise<ImportResult> {
  if (rows.length === 0) return { created: 0, updated: 0, skipped: 0 }

  return withTransaction(async () => {
    const brandIds = new Map<string, string>()
    const supplierIds = new Map<string, string>()
    const locationIds = new Map<string, string>()
    const ownerIds = new Map<string, string>()

    // Unchanged rows are not written, so they need nothing resolved and must
    // not create a brand or supplier as a side effect of being looked at.
    const writing = rows.filter((r) => r.action !== 'UNCHANGED')

    for (const row of writing) {
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
      if (row.owner && !ownerIds.has(row.owner.toLowerCase())) {
        const found = await db.select({ id: owners.id }).from(owners)
          .where(and(eq(owners.slug, slugify(row.owner)), isNull(owners.deletedAt))).limit(1)
        if (!found[0]) throw new Error(`Owner "${row.owner}" no longer exists.`)
        ownerIds.set(row.owner.toLowerCase(), found[0].id)
      }
    }

    const highest = await db.select({ max: watches.stockNo }).from(watches)
      .orderBy(watches.stockNo).limit(1)
    let nextStock = Math.max(1399, ...(await db.select({ n: watches.stockNo }).from(watches)).map((r) => r.n)) + 1
    void highest

    let created = 0
    let updated = 0

    for (const row of writing) {
      const priceMinor = toMinor(row.purchasePriceGbp!)
      const { gbp: estGbp, usd: estUsd } = estimateFromSheet(row.estSaleGbp)
      const locationId = locationIds.get(row.location.toLowerCase())!
      const ownerId = row.owner ? ownerIds.get(row.owner.toLowerCase())! : null

      // An existing watch is amended, not re-created. Only the fields the
      // preview listed are touched, so a sheet that changed one price cannot
      // quietly reset a status, a condition or a set of papers that the
      // spreadsheet never carried a column for.
      if (row.action === 'UPDATE' && row.watchId) {
        // The version is bumped like any other edit. Without it, a form opened
        // before the import and saved after it would carry a version the row
        // still had, pass the concurrency check, and quietly put back what the
        // sheet just changed.
        const patch: Record<string, unknown> = {
          updatedAt: new Date(),
          version: sql`${watches.version} + 1`,
        }
        const changed = new Set(row.changes.map((c) => c.field))
        if (changed.has('brand')) patch.brandId = brandIds.get(row.brand.toLowerCase())!
        if (changed.has('reference')) patch.model = row.model
        if (changed.has('serial')) patch.serial = row.serial
        if (changed.has('type')) patch.productType = row.productType
        if (changed.has('supplier')) patch.supplierId = supplierIds.get(row.supplier.toLowerCase())!
        if (changed.has('location')) patch.locationId = locationId
        if (changed.has('owner')) patch.ownerId = ownerId
        if (changed.has('purchase date')) patch.purchaseDate = new Date(row.purchaseDate)
        if (changed.has('purchase price')) {
          patch.purchasePriceGbp = priceMinor
          patch.purchasePriceUsd = priceMinor
          patch.purchaseAmount = priceMinor
          patch.purchaseCurrency = BASE_CURRENCY
          patch.purchaseFxRate = RATE_SCALE
        }
        if (changed.has('retail')) {
          patch.estSaleGbp = estGbp
          patch.estSaleUsd = estUsd
          patch.estSaleAmount = estGbp
          patch.estSaleCurrency = BASE_CURRENCY
        }
        for (const [field, value] of Object.entries(row.spec)) {
          if (value !== null && changed.has(field)) patch[field] = value
        }

        await db.update(watches).set(patch).where(eq(watches.id, row.watchId))
        await recordAudit({
          entityType: 'Watch', entityId: row.watchId, action: 'UPDATE', actorId: actor.id,
          summary: `Stock ${row.stockNo} updated from an imported sheet`,
          changes: Object.fromEntries(
            row.changes.map((c) => [c.field, { from: c.from, to: c.to }]),
          ),
        })

        // A location change is a stock movement in its own right, exactly as it
        // is when somebody edits the watch by hand.
        if (changed.has('location')) {
          await db.insert(stockMovements).values({
            id: newId('mov'), watchId: row.watchId, fromLocationId: null,
            toLocationId: locationId, reason: 'Moved by import', movedById: actor.id,
          })
        }
        updated += 1
        continue
      }

      const id = newId('wch')
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
        // The parse stage has already converted the sheet into the base, so the
        // figure is dollars by the time it reaches here. Applying the rate a
        // second time was booking every imported watch a third high.
        purchasePriceUsd: priceMinor,
        purchaseFxRate: RATE_SCALE,
        purchaseAmount: priceMinor,
        purchaseCurrency: BASE_CURRENCY,
        estSaleUsd: estUsd,
        // The spreadsheet quotes estimates in dollars, but every report
        // aggregates the GBP base. Omitting it made an imported watch count as
        // unpriced no matter what the sheet said.
        estSaleGbp: estGbp,
        estSaleAmount: estGbp,
        estSaleCurrency: BASE_CURRENCY,
        locationId,
        ownerId,
        // Whatever the sheet knew about the watch itself. Nulls fall through
        // to the column defaults rather than overwriting them with nothing.
        year: row.spec.year,
        caseSizeMm: row.spec.caseSizeMm,
        caseMaterial: row.spec.caseMaterial,
        dial: row.spec.dial,
        bracelet: row.spec.bracelet,
        movement: row.spec.movement,
        waterResistanceM: row.spec.waterResistanceM,
        description: row.spec.description,
        ...(row.spec.condition ? { condition: row.spec.condition as never } : {}),
        ...(row.spec.boxPapers ? { boxPapers: row.spec.boxPapers as never } : {}),
        createdById: actor.id,
      })
      await db.insert(stockMovements).values({
        id: newId('mov'), watchId: id, fromLocationId: null,
        toLocationId: locationId, reason: 'Imported from CSV', movedById: actor.id,
      })
      created += 1
      nextStock += 1
    }

    const skipped = rows.length - writing.length
    await recordAudit({
      entityType: 'Watch', entityId: 'bulk', action: 'IMPORT', actorId: actor.id,
      summary: `Import: ${created} booked in, ${updated} updated, ${skipped} unchanged`,
    })
    logger.info('import committed', { created, updated, skipped, actorId: actor.id })
    return { created, updated, skipped }
  })
}

/**
 * Read the Type column, by code or by label.
 *
 * Returns null for anything unrecognised rather than guessing, so the caller
 * can say so and still import the row as a watch: a misspelt type is not a
 * reason to reject a watch whose price, supplier and date are all correct.
 */
/**
 * Turn a label back into the code it came from.
 *
 * The export writes "Full set" because that is what a person reads; a sheet
 * coming home has to be able to say the same word back. Matched on the label
 * and on the code, case-insensitively, so both a downloaded export and
 * somebody typing "EXCELLENT" land in the same place.
 */
function matchLabel(raw: string, labels: Record<string, string>): string | null {
  if (!raw) return null
  const needle = raw.trim().toLowerCase()
  for (const [code, label] of Object.entries(labels)) {
    if (code.toLowerCase() === needle || label.toLowerCase() === needle) return code
  }
  return null
}

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

/**
 * Read a money cell, however the spreadsheet chose to dress it up.
 *
 * The export formats figures the way the screens do — "AED 35,340.12",
 * "HK$1,200", "£9,631.56", "$568.44" — because a column of bare numbers is what
 * somebody reconciles against and gets wrong. That formatting then has to
 * survive the trip home: this stripped only the pound and dollar signs, so an
 * export by anyone reading in dirhams or Hong Kong dollars failed on every
 * single row, on a file the application had just written.
 *
 * Any currency symbol or three-letter code is removed, along with grouping
 * separators. A parenthesised figure is negative, as accountants write it.
 */
export function parseAmount(raw: string): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const negative = /^\(.*\)$/.test(trimmed)
  const cleaned = trimmed
    .replace(/^\(|\)$/g, '')
    .replace(new RegExp(`\\b(?:${CURRENCIES.join('|')})\\b`, 'gi'), '')
    .replace(/[£$€¥,\s]/g, '')
    .replace(/HK/gi, '')
  if (cleaned === '' || cleaned === '-') return null
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return null
  return negative ? -parsed : parsed
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
  estimateMajor: number | null,
): { gbp: number | null; usd: number | null } {
  if (estimateMajor === null) return { gbp: null, usd: null }
  const base = toMinor(estimateMajor)
  // One figure in two columns. The estimate arrives already converted into the
  // base, and the base is dollars, so the retained USD column holds the same
  // number; converting it again would put a third onto every forecast.
  return { gbp: base, usd: base }
}
