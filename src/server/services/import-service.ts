import { and, eq, isNull } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { brands, locations, suppliers, watches, stockMovements } from '../db/schema'
import { recordAudit } from './audit'
import { newId, slugify } from '@/lib/ids'
import { toMinor } from '@/lib/money'
import { logger } from '@/lib/logger'
import { parseCsv } from '@/lib/csv'
import type { SessionUser } from '../auth/session'

/**
 * CSV import for stock.
 *
 * Deliberately two-phase: `parseImport` validates and reports, `commitImport`
 * writes. Users pasting a spreadsheet export need to see exactly what will
 * happen before anything changes — a half-applied import of 200 watches is
 * far worse than a rejected one.
 */

export interface ImportRow {
  line: number
  stockNo: number | null
  brand: string
  model: string
  nickname: string | null
  serial: string | null
  supplier: string
  location: string
  purchaseDate: string
  purchasePriceGbp: number | null
  estSaleUsd: number | null
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

const REQUIRED = ['brand', 'model', 'supplier', 'location', 'purchase date', 'purchase price (gbp)'] as const

export async function parseImport(text: string): Promise<ImportPreview> {
  const table = parseCsv(text)
  const issues: ImportIssue[] = []
  const rows: ImportRow[] = []

  if (table.length < 2) {
    return {
      rows: [], issues: [{ line: 0, field: 'file', message: 'The file has no data rows.', severity: 'error' }],
      newBrands: [], newSuppliers: [], unknownLocations: [], validCount: 0, errorCount: 1,
    }
  }

  const header = table[0]!.map((h) => h.trim().toLowerCase())
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

    const brand = value('brand')
    const model = value('model')
    const supplier = value('supplier')
    const location = value('location')
    const serial = value('serial') || null
    const rawDate = value('purchase date')
    const rawPrice = value('purchase price (gbp)')
    const rawEst = value('est sale (usd)')

    let errored = false
    const fail = (field: string, message: string) => {
      issues.push({ line, field, message, severity: 'error' })
      errored = true
    }

    if (!brand) fail('brand', 'Brand is required.')
    if (!model) fail('model', 'Model is required.')
    if (!supplier) fail('supplier', 'Supplier is required.')

    const date = parseDate(rawDate)
    if (!date) fail('purchase date', `Could not read the date "${rawDate}". Use DD/MM/YYYY or YYYY-MM-DD.`)
    else if (date.getTime() > Date.now() + 86_400_000) fail('purchase date', 'Purchase date is in the future.')

    const price = parseAmount(rawPrice)
    if (price === null) fail('purchase price (gbp)', `Could not read the price "${rawPrice}".`)
    else if (price <= 0) fail('purchase price (gbp)', 'Purchase price must be greater than zero.')

    const est = rawEst ? parseAmount(rawEst) : null
    if (rawEst && est === null) {
      issues.push({ line, field: 'est sale (usd)', message: `Ignoring unreadable sale price "${rawEst}".`, severity: 'warning' })
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
        line, stockNo: null, brand, model,
        nickname: value('nickname') || null, serial,
        supplier, location, purchaseDate: date!.toISOString(),
        purchasePriceGbp: price, estSaleUsd: est,
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
      const locationId = locationIds.get(row.location.toLowerCase())!
      await db.insert(watches).values({
        id,
        stockNo: nextStock,
        brandId: brandIds.get(row.brand.toLowerCase())!,
        model: row.model,
        nickname: row.nickname,
        serial: row.serial,
        supplierId: supplierIds.get(row.supplier.toLowerCase())!,
        purchaseDate: new Date(row.purchaseDate),
        purchasePriceGbp: priceMinor,
        purchasePriceUsd: Math.round(priceMinor * fx),
        purchaseFxRate: Math.round(fx * 10_000),
        estSaleUsd: row.estSaleUsd !== null ? toMinor(row.estSaleUsd) : null,
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
