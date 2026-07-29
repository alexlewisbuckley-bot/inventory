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

/**
 * The type caption for a location, or nothing when it only repeats the name.
 *
 * The transit location is called "In transit" and is of type "In transit", so
 * printing both put the same two words on consecutive lines wherever a
 * location was listed.
 */
export function locationTypeCaption(name: string, type: LocationType): string | null {
  const label = LOCATION_TYPE_LABELS[type]
  return label.toLowerCase() === name.trim().toLowerCase() ? null : label
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

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

/**
 * How a customer prefers to be reached.
 *
 * Recorded because getting it wrong is expensive in a business built on
 * relationships: emailing somebody who only ever answers WhatsApp produces a
 * customer who looks unresponsive and is not.
 */
export const CONTACT_CHANNELS = ['EMAIL', 'PHONE', 'WHATSAPP', 'SMS', 'IN_PERSON'] as const
export type ContactChannel = (typeof CONTACT_CHANNELS)[number]

export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  EMAIL: 'Email',
  PHONE: 'Phone',
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
  IN_PERSON: 'In person',
}

/**
 * How much of the business a customer represents.
 *
 * Deliberately three levels. A finer scale invites arguments about the
 * boundary and produces no different behaviour.
 */
/**
 * The two lines of business.
 *
 * Not the same thing as a sale's channel: the channel describes one
 * transaction, this describes what kind of counterparty somebody is. It
 * decides the price you quote, the paperwork you need and how you speak to
 * them, and it does not change from one sale to the next.
 */
export const CUSTOMER_TYPES = ['RETAIL', 'TRADE'] as const
export type CustomerType = (typeof CUSTOMER_TYPES)[number]

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  RETAIL: 'Retail',
  TRADE: 'Trade',
}

export const CUSTOMER_TYPE_DESCRIPTIONS: Record<CustomerType, string> = {
  RETAIL: 'A private buyer. Direct-to-consumer.',
  TRADE: 'Another dealer or business. Business-to-business.',
}

export const CUSTOMER_TIERS = ['STANDARD', 'PRIORITY', 'VIP'] as const
export type CustomerTier = (typeof CUSTOMER_TIERS)[number]

export const CUSTOMER_TIER_LABELS: Record<CustomerTier, string> = {
  STANDARD: 'Standard',
  PRIORITY: 'Priority',
  VIP: 'VIP',
}

export const CUSTOMER_STATUSES = ['ACTIVE', 'DORMANT', 'BLOCKED'] as const
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number]

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  ACTIVE: 'Active',
  DORMANT: 'Dormant',
  BLOCKED: 'Blocked',
}

export const LEAD_SOURCES = [
  'UNKNOWN', 'REFERRAL', 'WALK_IN', 'INSTAGRAM', 'WEBSITE', 'MARKETPLACE',
  'REPEAT', 'TRADE', 'EVENT',
] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  UNKNOWN: 'Not recorded',
  REFERRAL: 'Referral',
  WALK_IN: 'Walk-in',
  INSTAGRAM: 'Instagram',
  WEBSITE: 'Website',
  MARKETPLACE: 'Marketplace',
  REPEAT: 'Repeat customer',
  TRADE: 'Trade contact',
  EVENT: 'Event or fair',
}

/**
 * The pipeline.
 *
 * Ordered, and the order is the board. Two of these are terminal: WON hands
 * over to the sales ledger, LOST keeps the reason. Nothing sits in a stage
 * called "archived" — a deal that is finished is one of the two.
 */
export const DEAL_STAGES = [
  'ENQUIRY', 'QUALIFIED', 'SOURCING', 'OFFER_SENT', 'NEGOTIATION',
  'DEPOSIT_TAKEN', 'PAYMENT_PENDING', 'WON', 'LOST',
] as const
export type DealStage = (typeof DEAL_STAGES)[number]

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  ENQUIRY: 'New enquiry',
  QUALIFIED: 'Qualified',
  SOURCING: 'Sourcing',
  OFFER_SENT: 'Offer sent',
  NEGOTIATION: 'Negotiation',
  DEPOSIT_TAKEN: 'Deposit taken',
  PAYMENT_PENDING: 'Payment pending',
  WON: 'Won',
  LOST: 'Lost',
}

/** The stages a deal can still move through under its own steam. */
export const OPEN_DEAL_STAGES = DEAL_STAGES.filter(
  (stage) => stage !== 'WON' && stage !== 'LOST',
) as readonly DealStage[]

/**
 * Default likelihood per stage.
 *
 * A forecast nobody maintains is worse than no forecast, so the probability is
 * pre-filled from the stage and can be overridden per deal.
 */
export const DEAL_STAGE_PROBABILITY: Record<DealStage, number> = {
  ENQUIRY: 10,
  QUALIFIED: 25,
  SOURCING: 35,
  OFFER_SENT: 50,
  NEGOTIATION: 65,
  DEPOSIT_TAKEN: 85,
  PAYMENT_PENDING: 95,
  WON: 100,
  LOST: 0,
}

export const OFFER_STATUSES = ['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'] as const
export type OfferStatus = (typeof OFFER_STATUSES)[number]

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  WITHDRAWN: 'Withdrawn',
}

export const REQUEST_STATUSES = ['OPEN', 'SOURCING', 'MATCHED', 'FULFILLED', 'CANCELLED'] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  OPEN: 'Open',
  SOURCING: 'Sourcing',
  MATCHED: 'Match found',
  FULFILLED: 'Fulfilled',
  CANCELLED: 'Cancelled',
}

export const REQUEST_ENQUIRY_STATUSES = ['SENT', 'QUOTED', 'DECLINED', 'NO_REPLY'] as const
export type RequestEnquiryStatus = (typeof REQUEST_ENQUIRY_STATUSES)[number]

export const REQUEST_ENQUIRY_STATUS_LABELS: Record<RequestEnquiryStatus, string> = {
  SENT: 'Asked',
  QUOTED: 'Quoted',
  DECLINED: 'Declined',
  NO_REPLY: 'No reply',
}

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const
export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
}

/** Every kind of contact worth remembering, in one list. */
export const ACTIVITY_TYPES = [
  'NOTE', 'CALL', 'EMAIL', 'WHATSAPP', 'SMS', 'MEETING', 'VIDEO',
  'OFFER', 'STAGE_CHANGE', 'PURCHASE', 'SALE', 'VALUATION', 'SYSTEM',
] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  NOTE: 'Note',
  CALL: 'Call',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
  MEETING: 'Meeting',
  VIDEO: 'Video call',
  OFFER: 'Offer',
  STAGE_CHANGE: 'Stage change',
  PURCHASE: 'Purchase',
  SALE: 'Sale',
  VALUATION: 'Valuation',
  SYSTEM: 'System',
}

/** The types a person can log by hand; the rest are written by the system. */
export const LOGGABLE_ACTIVITY_TYPES = [
  'NOTE', 'CALL', 'EMAIL', 'WHATSAPP', 'SMS', 'MEETING', 'VIDEO', 'VALUATION',
] as const

export const ACTIVITY_DIRECTIONS = ['INBOUND', 'OUTBOUND', 'INTERNAL'] as const
export type ActivityDirection = (typeof ACTIVITY_DIRECTIONS)[number]

export const TASK_KINDS = ['FOLLOW_UP', 'CALL', 'EMAIL', 'MEETING', 'ADMIN', 'SOURCING', 'DELIVERY'] as const
export type TaskKind = (typeof TASK_KINDS)[number]

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  FOLLOW_UP: 'Follow up',
  CALL: 'Call',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  ADMIN: 'Admin',
  SOURCING: 'Sourcing',
  DELIVERY: 'Delivery',
}

export const TASK_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const PAYMENT_STATUSES = ['PAID', 'DEPOSIT', 'PENDING', 'OVERDUE', 'REFUNDED'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PAID: 'Paid in full',
  DEPOSIT: 'Deposit taken',
  PENDING: 'Awaiting payment',
  OVERDUE: 'Overdue',
  REFUNDED: 'Refunded',
}

export const DELIVERY_STATUSES = ['COLLECTED', 'SHIPPED', 'AWAITING', 'DELIVERED'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  COLLECTED: 'Collected',
  SHIPPED: 'Shipped',
  AWAITING: 'Awaiting despatch',
  DELIVERED: 'Delivered',
}

/** Which entity a tag or timeline row is attached to. */
export const CRM_ENTITIES = ['Customer', 'Supplier', 'Watch', 'Deal', 'Request'] as const
export type CrmEntity = (typeof CRM_ENTITIES)[number]
