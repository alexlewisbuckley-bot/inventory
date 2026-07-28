import {
  BOX_PAPERS_LABELS, CONDITION_LABELS, ENTITY_TYPE_LABELS, LOCATION_TYPE_LABELS,
  PAYMENT_TERMS_LABELS, ROLE_LABELS, SALE_CHANNEL_LABELS, WATCH_STATUS_LABELS,
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
  estSaleAmount: 'Est. sale price',
  estSaleCurrency: 'Est. sale currency',
  estSaleGbp: 'Est. sale price',
  estSaleUsd: 'Est. sale price',
  isActive: 'Active',
  legalName: 'Legal entity',
  locationId: 'Location',
  model: 'Reference number',
  paymentTerms: 'Payment terms',
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
  ...SALE_CHANNEL_LABELS,
  ...LOCATION_TYPE_LABELS,
  ...ENTITY_TYPE_LABELS,
  ...PAYMENT_TERMS_LABELS,
  ...ROLE_LABELS,
}

export function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field]
  // Fall back to splitting camelCase, which reads far better than the raw key.
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function changeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'not set'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (value instanceof Date) return value.toLocaleDateString('en-GB')
  const text = String(value)
  return VALUE_LABELS[text] ?? text
}
