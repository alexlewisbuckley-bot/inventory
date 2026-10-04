import { fromBase, type RateTable } from './currency'
import type { CurrencyCode } from './enums'

/**
 * What a watch looks like as a Shopify product, and what has to change.
 *
 * Kept away from the network on purpose. Everything here is a pure function of
 * two lists — the stock we hold and the products the store currently has — so
 * the decision to delete somebody's live product page can be tested, which is
 * not true of anything that needs an access token to run.
 *
 * The shop is a mirror. The inventory system is the book of record and Shopify
 * reflects it; nothing flows the other way. That single rule is what makes a
 * plan computable at all: there is no merge to do, only a difference to apply.
 */

/** The statuses that mean we still have the watch. */
const HELD = new Set(['IN_STOCK', 'RESERVED', 'SALE_AGREED'])

/**
 * A SKU we recognise as ours.
 *
 * The store already used stock numbers as SKUs before any of this existed,
 * which is the whole reason no matching exercise is needed: the join key was
 * already in the data. Anything else — a hand-made placeholder, a blank — is a
 * product this system did not create.
 */
export function isManagedSku(sku: string | null | undefined): boolean {
  return typeof sku === 'string' && /^\d{1,10}$/.test(sku.trim())
}

export function skuFor(stockNo: number): string {
  return String(stockNo)
}

export interface SyncWatch {
  id: string
  stockNo: number
  brandName: string
  model: string
  serial: string | null
  nickname: string | null
  year: number | null
  status: string
  estSaleGbp: number | null
  caseSizeMm: number | null
  caseMaterial: string | null
  dial: string | null
  bracelet: string | null
  movement: string | null
  waterResistanceM: number | null
  condition: string
  boxPapers: string
  description: string | null
  imageIds: string[]
  shopifyProductId: string | null
}

/** A product as the store has it now. */
export interface SyncProduct {
  id: string
  sku: string | null
  title: string
  status: string
}

export type ShopifyStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED'

/**
 * Whether a watch should be on the storefront, and in what state.
 *
 * A watch with no retail price is not a listing. Publishing one means either a
 * price of zero on the page or a figure invented to fill the field, and both
 * are worse than the watch being absent — so it goes up as a draft, where it
 * is ready the moment somebody prices it.
 */
export function statusFor(watch: Pick<SyncWatch, 'status' | 'estSaleGbp'>): ShopifyStatus {
  if (!HELD.has(watch.status)) return 'ARCHIVED'
  if (watch.estSaleGbp === null || watch.estSaleGbp <= 0) return 'DRAFT'
  return 'ACTIVE'
}

/**
 * How many we have, which for a watch is one or none.
 *
 * Reserved and sale-agreed stock stays visible but unbuyable: the page is
 * still worth having — it is what somebody was sent a link to — and the watch
 * is genuinely spoken for.
 */
export function quantityFor(watch: Pick<SyncWatch, 'status'>): number {
  return watch.status === 'IN_STOCK' ? 1 : 0
}

/** The price, in the store's own currency. */
export function priceFor(
  estSaleGbp: number | null,
  storeCurrency: CurrencyCode,
  rates: RateTable,
): string | null {
  if (estSaleGbp === null || estSaleGbp <= 0) return null
  return (fromBase(estSaleGbp, storeCurrency, rates) / 100).toFixed(2)
}

/**
 * The name on the page.
 *
 * Reference first for anything a buyer searches by, because that is what they
 * type. The nickname earns its place — "Hulk" sells a 116610LV — and the year
 * belongs in the title for a watch where it changes the thing entirely.
 */
export function titleFor(watch: SyncWatch): string {
  return [
    watch.brandName,
    watch.model,
    watch.nickname ? `"${watch.nickname}"` : null,
  ].filter(Boolean).join(' ')
}

const SPEC_LABELS: Array<[keyof SyncWatch, string, (v: never) => string]> = [
  ['year', 'Year', (v: number) => String(v)],
  ['caseSizeMm', 'Case', (v: number) => `${v}mm`],
  ['caseMaterial', 'Material', (v: string) => v],
  ['dial', 'Dial', (v: string) => v],
  ['bracelet', 'Bracelet', (v: string) => v],
  ['movement', 'Movement', (v: string) => v],
  ['waterResistanceM', 'Water resistance', (v: number) => `${v}m`],
] as never

/**
 * The description, as the specification plus whatever was written about it.
 *
 * Built from the record rather than typed into Shopify, because a description
 * maintained in two places is a description that disagrees with itself. Rows
 * with nothing in them are left out instead of being filled with "unknown",
 * which on a watch page reads as a warning rather than an absence.
 */
export function descriptionHtmlFor(watch: SyncWatch): string {
  const rows = SPEC_LABELS
    .map(([key, label, format]) => {
      const value = watch[key]
      return value === null || value === undefined || value === ''
        ? null
        : `<tr><th align="left">${label}</th><td>${escapeHtml(format(value as never))}</td></tr>`
    })
    .filter(Boolean)

  const prose = watch.description?.trim()
    ? `<p>${escapeHtml(watch.description.trim()).replace(/\n+/g, '</p><p>')}</p>`
    : ''

  return `${prose}${rows.length ? `<table>${rows.join('')}</table>` : ''}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface SyncPlan {
  /** Watches with no product yet. */
  create: SyncWatch[]
  /** Watches whose product exists and must be brought into line. */
  update: Array<{ watch: SyncWatch; productId: string }>
  /** Products for stock we no longer hold. */
  archive: Array<{ productId: string; sku: string | null; title: string }>
  /** Products that answer to no watch at all. */
  remove: Array<{ productId: string; sku: string | null; title: string }>
}

/**
 * What it would take to make the store match the book.
 *
 * Computed whole, before anything is sent, so the irreversible half can be
 * read by a person first. `remove` is the dangerous list — products deleted
 * outright, which on a store with order history would break reporting and on
 * this one, where the site takes enquiries rather than payments, simply
 * removes pages nothing points at. Either way it is shown before it is done.
 *
 * A product whose SKU matches a watch we still hold is never removed, however
 * odd it looks; a duplicate SKU keeps the first product and removes the rest,
 * because two live pages for one watch is the thing that sells it twice.
 */
export function planSync(watches: SyncWatch[], products: SyncProduct[]): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], archive: [], remove: [] }

  const bySku = new Map<string, SyncProduct>()
  const duplicates: SyncProduct[] = []
  for (const product of products) {
    const sku = product.sku?.trim() ?? ''
    if (!isManagedSku(sku)) { plan.remove.push(descr(product)); continue }
    // First one wins. The second page for the same stock number is the one
    // that has to go, whichever of them somebody made first.
    if (bySku.has(sku)) { duplicates.push(product); continue }
    bySku.set(sku, product)
  }
  for (const product of duplicates) plan.remove.push(descr(product))

  const seen = new Set<string>()
  for (const watch of watches) {
    const sku = skuFor(watch.stockNo)
    seen.add(sku)
    const existing = bySku.get(sku)
    if (existing) plan.update.push({ watch, productId: existing.id })
    else if (HELD.has(watch.status)) plan.create.push(watch)
    // A sold watch with no product never needs one.
  }

  for (const [sku, product] of bySku) {
    // A product for a stock number that is not in the book at all. Archived
    // rather than deleted: the likeliest reason is a watch that has since been
    // sold and tidied away, and an archived page can be brought back.
    if (!seen.has(sku)) plan.archive.push(descr(product))
  }

  return plan
}

function descr(product: SyncProduct) {
  return { productId: product.id, sku: product.sku, title: product.title }
}
