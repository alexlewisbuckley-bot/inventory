/**
 * Central enum registry.
 *
 * Every value stored in a `text` column that behaves like an enum is declared
 * here exactly once. Drizzle consumes the tuples for column typing, Zod
 * consumes them for request validation, and the UI consumes the label maps —
 * so a new status can never be added in one layer and forgotten in another.
 */

export const ROLES = ['OWNER', 'MANAGER', 'STAFF', 'VIEWER'] as const
export type Role = (typeof ROLES)[number]

export const WATCH_STATUSES = [
  'IN_STOCK',
  'RESERVED',
  'SALE_AGREED',
  'SOLD',
  'RETURNED',
  'WRITTEN_OFF',
] as const
export type WatchStatus = (typeof WATCH_STATUSES)[number]

export const LOCATION_TYPES = ['STORE', 'VAULT', 'TRANSIT', 'CONSIGNMENT'] as const
export type LocationType = (typeof LOCATION_TYPES)[number]

export const CONDITIONS = ['UNKNOWN', 'UNWORN', 'EXCELLENT', 'GOOD', 'FAIR'] as const
export type Condition = (typeof CONDITIONS)[number]

export const BOX_PAPERS = ['UNKNOWN', 'FULL_SET', 'WATCH_ONLY', 'BOX_ONLY', 'PAPERS_ONLY'] as const
export type BoxPapers = (typeof BOX_PAPERS)[number]

export const SALE_CHANNELS = ['RETAIL', 'TRADE', 'ONLINE', 'AUCTION', 'CONSIGNMENT'] as const
export type SaleChannel = (typeof SALE_CHANNELS)[number]

/**
 * What kind of counterparty a supplier is.
 *
 * Determines what paperwork applies: a limited company has a registration
 * number, a sole trader does not, and a private seller has neither.
 */
export const ENTITY_TYPES = [
  'UNKNOWN', 'LIMITED_COMPANY', 'SOLE_TRADER', 'PARTNERSHIP', 'PRIVATE_SELLER', 'AUCTION_HOUSE',
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  UNKNOWN: 'Not recorded',
  LIMITED_COMPANY: 'Limited company',
  SOLE_TRADER: 'Sole trader',
  PARTNERSHIP: 'Partnership',
  PRIVATE_SELLER: 'Private seller',
  AUCTION_HOUSE: 'Auction house',
}

/** When the supplier expects to be paid. */
export const PAYMENT_TERMS = [
  'UNKNOWN', 'PREPAID', 'ON_COLLECTION', 'NET_7', 'NET_14', 'NET_30', 'NET_60', 'CONSIGNMENT',
] as const
export type PaymentTerms = (typeof PAYMENT_TERMS)[number]

export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  UNKNOWN: 'Not agreed',
  PREPAID: 'Paid in advance',
  ON_COLLECTION: 'On collection',
  NET_7: '7 days',
  NET_14: '14 days',
  NET_30: '30 days',
  NET_60: '60 days',
  CONSIGNMENT: 'On consignment — paid when sold',
}

export const AUDIT_ACTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'LOGIN', 'LOGOUT',
  'EXPORT', 'IMPORT', 'MOVE', 'SELL', 'PASSWORD_CHANGE',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const NOTIFICATION_TYPES = [
  'STOCK_ADDED', 'SALE_RECORDED', 'WATCH_MOVED', 'PRICE_MISSING', 'AGEING_STOCK', 'SYSTEM',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const IMAGE_KINDS = ['WATCH', 'CARD', 'DOCUMENT'] as const
export type ImageKind = (typeof IMAGE_KINDS)[number]

export const IMAGE_KIND_LABELS: Record<ImageKind, string> = {
  WATCH: 'Watch',
  CARD: 'Warranty card',
  DOCUMENT: 'Document',
}

export const THEMES = ['LIGHT', 'DARK', 'SYSTEM'] as const
export type Theme = (typeof THEMES)[number]

export const DENSITIES = ['COMFORTABLE', 'COMPACT'] as const
export type Density = (typeof DENSITIES)[number]

export const CURRENCIES = ['GBP', 'USD', 'AED', 'HKD'] as const
export type CurrencyCode = (typeof CURRENCIES)[number]

/** The currency every amount is stored in. Everything else is converted. */
export const BASE_CURRENCY: CurrencyCode = 'GBP'

export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  GBP: 'British pound',
  USD: 'US dollar',
  AED: 'UAE dirham',
  HKD: 'Hong Kong dollar',
}

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  GBP: '£',
  USD: '$',
  AED: 'AED',
  HKD: 'HK$',
}

// --- Presentation metadata -------------------------------------------------

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  STAFF: 'Staff',
  VIEWER: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: 'Full control including user management, settings and permanent deletion.',
  MANAGER: 'Manage stock, sales, suppliers and locations. Can export and import.',
  STAFF: 'Add and edit stock, move watches between locations and record sales.',
  VIEWER: 'Read-only access to stock and reports.',
}

export const WATCH_STATUS_LABELS: Record<WatchStatus, string> = {
  IN_STOCK: 'In stock',
  RESERVED: 'Reserved',
  SALE_AGREED: 'Sale agreed',
  SOLD: 'Sold',
  RETURNED: 'Returned',
  WRITTEN_OFF: 'Written off',
}

/** Maps a status onto the Chip component's visual tone. */
export const WATCH_STATUS_TONE: Record<WatchStatus, 'accent' | 'gold' | 'navy' | 'neutral' | 'danger'> = {
  IN_STOCK: 'accent',
  RESERVED: 'navy',
  SALE_AGREED: 'gold',
  SOLD: 'navy',
  RETURNED: 'neutral',
  WRITTEN_OFF: 'danger',
}

/** Statuses that still represent owned, sellable inventory. */
export const ACTIVE_STATUSES: readonly WatchStatus[] = ['IN_STOCK', 'RESERVED', 'SALE_AGREED']

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  STORE: 'Store',
  VAULT: 'Vault / safe',
  TRANSIT: 'In transit',
  CONSIGNMENT: 'On consignment',
}

export const CONDITION_LABELS: Record<Condition, string> = {
  UNKNOWN: 'Not recorded',
  UNWORN: 'Unworn',
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  FAIR: 'Fair',
}

export const BOX_PAPERS_LABELS: Record<BoxPapers, string> = {
  UNKNOWN: 'Not recorded',
  FULL_SET: 'Full set',
  WATCH_ONLY: 'Watch only',
  BOX_ONLY: 'Box only',
  PAPERS_ONLY: 'Papers only',
}

export const SALE_CHANNEL_LABELS: Record<SaleChannel, string> = {
  RETAIL: 'Retail',
  TRADE: 'Trade',
  ONLINE: 'Online',
  AUCTION: 'Auction',
  CONSIGNMENT: 'Consignment',
}

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  RESTORE: 'Restored',
  LOGIN: 'Signed in',
  LOGOUT: 'Signed out',
  EXPORT: 'Exported',
  IMPORT: 'Imported',
  MOVE: 'Moved',
  SELL: 'Sold',
  PASSWORD_CHANGE: 'Changed password',
}
