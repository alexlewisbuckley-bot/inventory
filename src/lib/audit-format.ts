import { formatCurrency } from './currency'
import {
  BASE_CURRENCY, BOX_PAPERS_LABELS, CONDITION_LABELS, ENTITY_TYPE_LABELS, LOCATION_TYPE_LABELS,
  PAYMENT_TERMS_LABELS, PRODUCT_TYPE_LABELS, ROLE_LABELS, SALE_CHANNEL_LABELS, WATCH_STATUS_LABELS,
} from './enums'

/**
 * Field names as a person would say them.
 *
 * The audit trail was printing the database column: "estSaleGbp: null → 1498000".
 * It is the one screen whose whole purpose is being read by a human later,
 * usually when something has gone wrong and nobody remembers what changed.
 */
const FIELD_LABELS: Record<string, string> = {
  brandId: 'Brand',
  boxPapers: 'Box & papers',
  condition: 'Condition',
  contactEmail: 'Contact email',
  contactName: 'Representative',
  contactPhone: 'Contact phone',
  contactRole: 'Representative role',
  defaultCurrency: 'Invoicing currency',
  entityType: 'Entity type',
  estSaleAmount: 'Retail price',
  estSaleCurrency: 'Retail currency',
  estSaleGbp: 'Retail price',
  estSaleUsd: 'Retail price',
  isActive: 'Active',
  legalName: 'Legal entity',
  locationId: 'Location',
  nickname: 'Model',
  ownerId: 'Owner',
  caseSizeMm: 'Case size',
  caseMaterial: 'Case material',
  dial: 'Dial',
  bracelet: 'Bracelet',
  movement: 'Movement',
  waterResistanceM: 'Water resistance',
  description: 'Description',
  model: 'Reference number',
  paymentTerms: 'Payment terms',
  productType: 'Type',
  purchaseAmount: 'Purchase price',
  purchaseCurrency: 'Purchase currency',
  purchaseDate: 'Purchase date',
  purchasePriceGbp: 'Purchase price',
  purchasePriceUsd: 'Purchase price',
  registrationNo: 'Registration no.',
  supplierId: 'Supplier',
  vatNo: 'VAT number',
}

/**
 * Enum values as their labels, whichever enum they came from.
 *
 * The maps are searched rather than selected by field name because the same
 * value can arrive under several field names — status, from, to — and a lookup
 * table keyed on the field would have to be kept in step with all of them.
 * Values are unique enough across these enums that a collision would need two
 * enums to share a member, which none of them do.
 */
const VALUE_LABELS: Record<string, string> = {
  ...WATCH_STATUS_LABELS,
  ...CONDITION_LABELS,
  ...BOX_PAPERS_LABELS,
  ...PRODUCT_TYPE_LABELS,
  ...SALE_CHANNEL_LABELS,
  ...LOCATION_TYPE_LABELS,
  ...ENTITY_TYPE_LABELS,
  ...PAYMENT_TERMS_LABELS,
  ...ROLE_LABELS,
}

/**
 * Columns holding money, in minor units of the base currency.
 *
 * Without this the trail printed the stored integer: a cost of thirteen
 * thousand six hundred dollars read as "1360000", and a fat-fingered edit
 * beside it read as "1456", so the two were indistinguishable at a glance and
 * the one screen that exists to answer "what was it before" could not be read
 * at all. Shown in the base currency rather than the viewer's, because a
 * historical figure converted at today's rate is a number nobody ever typed.
 *
 * The older column names are here too. They no longer appear in a new entry,
 * but they are in the rows already written, and those are the rows people go
 * back to.
 *
 * Only the base columns. The `purchaseAmount` family is minor units of
 * whatever currency that entry was agreed in, which this function cannot see,
 * and a dirham figure behind a dollar sign is worse than a bare integer: one
 * is visibly unformatted, the other is quietly wrong.
 */
const MONEY_FIELDS = new Set([
  'purchasePriceGbp', 'purchasePriceUsd',
  'estSaleGbp', 'estSaleUsd',
  'tradePriceGbp', 'salePriceGbp',
  'valueGbp', 'depositGbp',
])

export function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field]
  // Fall back to splitting camelCase, which reads far better than the raw key.
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function changeValue(value: unknown, field?: string): string {
  if (value === null || value === undefined || value === '') return 'not set'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (value instanceof Date) return value.toLocaleDateString('en-GB')
  if (field && MONEY_FIELDS.has(field)) {
    // Pence included: the mistake this screen gets opened for is usually a
    // decimal point in the wrong place, and rounding it away hides it.
    const minor = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(minor)) return formatCurrency(minor, BASE_CURRENCY, { decimals: true })
  }
  const text = String(value)
  return VALUE_LABELS[text] ?? text
}
