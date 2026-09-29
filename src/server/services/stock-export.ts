import { IMPORT_COLUMNS, headerFor } from '@/lib/import-columns'
import { fromBase, type RateTable } from '@/lib/currency'
import { buildWorkbook, type SheetColumn } from './spreadsheet'
import type { CurrencyCode } from '@/lib/enums'

/** One row of stock, in the shape the sheet lays out. */
export interface StockExportRow {
  stockNo: number
  productType: string
  brandName: string
  model: string
  serial: string | null
  supplierName: string
  locationName: string
  ownerName: string | null
  purchaseDate: Date
  /** Base minor units — converted to the reader's currency here. */
  purchasePriceGbp: number
  estSaleGbp: number | null
  status: string
}

/**
 * The stock list as a spreadsheet.
 *
 * Columns, order and headers come from the import definition, so what this
 * writes is exactly what the importer accepts: this file is meant to be opened,
 * edited and sent straight back.
 *
 * Money is written as numbers carrying a currency format rather than as text
 * that merely looks like money, so a figure typed into a column matches the
 * ones already in it.
 */
export async function buildStockWorkbook(
  rows: readonly StockExportRow[],
  currency: CurrencyCode,
  rates: RateTable,
  productTypeLabels: Record<string, string>,
): Promise<Buffer> {
  const columns: SheetColumn[] = IMPORT_COLUMNS.map((column) => ({
    key: column.key,
    header: headerFor(column, currency),
    width: column.width,
    kind: column.money
      ? 'money'
      : column.key === 'purchase date' ? 'date'
        : column.key === 'stock no' ? 'integer' : 'text',
    // The two columns the importer will not read back.
    muted: column.derived,
  }))

  /** Base minor units as a major-unit number in the reader's currency. */
  const amount = (base: number | null): number | null =>
    base === null ? null : fromBase(base, currency, rates) / 100

  return buildWorkbook('Stock', columns, rows.map((row) => ({
    'stock no': row.stockNo,
    type: productTypeLabels[row.productType] ?? row.productType,
    brand: row.brandName,
    reference: row.model,
    serial: row.serial ?? '',
    supplier: row.supplierName,
    location: row.locationName,
    owner: row.ownerName ?? '',
    'purchase date': row.purchaseDate,
    'purchase price': amount(row.purchasePriceGbp),
    retail: amount(row.estSaleGbp),
    'est profit': amount(row.estSaleGbp === null ? null : row.estSaleGbp - row.purchasePriceGbp),
    status: row.status,
  })), currency)
}

export interface SaleExportRow {
  invoiceNo: string
  saleDate: Date
  stockNo: number
  brandName: string
  model: string
  supplierName: string
  customerName: string | null
  channel: string
  costGbp: number | null
  amountGbp: number
  profitGbp: number
  marginBps: number
}

/** The sales ledger as a spreadsheet, formatted like the stock sheet. */
export async function buildSalesWorkbook(
  rows: readonly SaleExportRow[],
  currency: CurrencyCode,
  rates: RateTable,
): Promise<Buffer> {
  const columns: SheetColumn[] = [
    { key: 'invoice', header: 'Invoice', width: 16 },
    { key: 'sale date', header: 'Sale Date', width: 14, kind: 'date' },
    { key: 'stock no', header: 'Stock No', width: 10, kind: 'integer' },
    { key: 'brand', header: 'Brand', width: 16 },
    { key: 'reference', header: 'Reference', width: 18 },
    { key: 'supplier', header: 'Supplier', width: 22 },
    { key: 'customer', header: 'Customer', width: 22 },
    { key: 'channel', header: 'Channel', width: 16 },
    { key: 'cost', header: `Cost (${currency})`, width: 16, kind: 'money' },
    { key: 'sale', header: `Sale (${currency})`, width: 16, kind: 'money' },
    { key: 'profit', header: `Profit (${currency})`, width: 16, kind: 'money' },
    // A real number with a percent format, not the string "12.34%". A ledger
    // gets sorted and totalled, and text does neither.
    { key: 'margin', header: 'Margin %', width: 12, kind: 'percent' },
  ]

  const amount = (base: number | null): number | null =>
    base === null ? null : fromBase(base, currency, rates) / 100

  return buildWorkbook('Sales', columns, rows.map((row) => ({
    invoice: row.invoiceNo,
    'sale date': row.saleDate,
    'stock no': row.stockNo,
    brand: row.brandName,
    reference: row.model,
    supplier: row.supplierName,
    customer: row.customerName ?? '',
    channel: row.channel,
    cost: amount(row.costGbp),
    sale: amount(row.amountGbp),
    profit: amount(row.profitGbp),
    margin: row.marginBps / 100,
  })), currency)
}
