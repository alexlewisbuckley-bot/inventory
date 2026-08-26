import { z } from 'zod'
import type { FilterClause } from './filters'
import {
  ACTIVITY_DIRECTIONS, ACTIVITY_TYPES, BASE_CURRENCY, BOX_PAPERS, CONDITIONS, CONTACT_CHANNELS,
  CURRENCIES, CUSTOMER_STATUSES, CUSTOMER_TIERS, CUSTOMER_TYPES, DEAL_STAGES, DEFAULT_PRODUCT_TYPE,
  DELIVERY_STATUSES, DENSITIES, ENTITY_TYPES, LEAD_SOURCES, LOCATION_TYPES, PAYMENT_STATUSES,
  PAYMENT_TERMS, PRIORITIES, PRODUCT_TYPES,
  REQUEST_STATUSES, ROLES, SALE_CHANNELS, TASK_KINDS, TASK_STATUSES, THEMES, WATCH_STATUSES,
} from './enums'

/**
 * Request validation.
 *
 * Every server action and API route parses its input through a schema here.
 * Schemas are the single source of truth for shape *and* for the error copy
 * shown to users, so messages stay consistent across the app.
 */

/**
 * An amount as the form actually posts it.
 *
 * The money inputs group thousands while they are typed — 9500 shows as
 * "9,500", which is the point of the control, since a mis-scanned 13105.51 is
 * one keystroke from a ten-times pricing error. The intake form posts that
 * string verbatim, and `z.coerce.number()` reads "9,500" as NaN: every
 * purchase over £999 entered by hand was rejected as "must be a number" while
 * the field plainly showed one. The quick-sell dialog escaped it only because
 * it parses the value itself before building its FormData.
 *
 * Stripped here rather than in each form, because the server should accept
 * what its own controls produce — and the next form to use MoneyField would
 * otherwise reintroduce this.
 */
const ungrouped = (value: unknown) =>
  (typeof value === 'string' ? value.replace(/[\s,]/g, '') : value)

const money = (label: string) =>
  z.preprocess(
    ungrouped,
    z.coerce.number({ invalid_type_error: `${label} must be a number.` })
      .min(0, `${label} cannot be negative.`)
      .max(100_000_000, `${label} looks too large — please check.`),
  )

/**
 * Optional money.
 *
 * Two rules, both load-bearing:
 *  1. Empty input is collapsed to null in `preprocess`.
 *  2. `z.null()` is the FIRST union branch. `z.coerce.number()` turns both ''
 *     and null into 0, and 0 satisfies `.min(0)`, so if the numeric branch is
 *     tried first it wins and a blank price is silently stored as zero —
 *     making an unpriced watch look priced at nothing and reporting a large
 *     false loss. Never put a coercing schema first in a union that can
 *     receive empty input.
 */
const optionalMoney = (label: string) =>
  z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? null : value),
    z.union([z.null(), money(label)]),
  ).optional()

const trimmed = z.string().trim()
const optionalText = (max = 500) =>
  z.union([trimmed.max(max), z.literal('')]).optional().transform((v) => (v ? v : null))

export const emailSchema = trimmed.min(1, 'Email address is required.').email('Enter a valid email address.')
  .max(255).toLowerCase()

// --- Auth ------------------------------------------------------------------

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.').max(200),
  redirectTo: z.string().startsWith('/').optional(),
})
export type LoginInput = z.infer<typeof loginSchema>

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().min(10, 'Use at least 10 characters.').max(200),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'The two passwords do not match.', path: ['confirmPassword'],
})

// --- Watches ---------------------------------------------------------------

export const watchCreateSchema = z.object({
  /**
   * Defaulted rather than required, so every existing caller — the importer,
   * the sourcing hand-off, an older bookmarked form post — keeps working and
   * lands a watch, which is what all of them meant.
   */
  productType: z.enum(PRODUCT_TYPES).default(DEFAULT_PRODUCT_TYPE),
  brandId: trimmed.min(1, 'Choose a brand.'),
  model: trimmed.min(1, 'Reference number is required.').max(80),
  nickname: optionalText(80),
  serial: optionalText(60),
  // Same null-branch-first rule as optionalMoney above.
  year: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? null : value),
    z.union([
      z.null(),
      z.coerce.number().int().min(1900, 'Year looks too early.').max(new Date().getFullYear() + 1),
    ]),
  ).optional(),
  condition: z.enum(CONDITIONS).default('UNKNOWN'),
  boxPapers: z.enum(BOX_PAPERS).default('UNKNOWN'),
  supplierId: trimmed.min(1, 'Choose a supplier.'),
  purchaseDate: z.coerce.date({ invalid_type_error: 'Enter a valid purchase date.' })
    .max(new Date(Date.now() + 86_400_000), 'Purchase date cannot be in the future.'),
  /**
   * Prices are captured in the currency they were agreed in. The service
   * converts to the GBP base through the managed rate table — doing it here
   * would need a database read inside a validator.
   */
  purchaseAmount: money('Purchase price'),
  purchaseCurrency: z.enum(CURRENCIES).default(BASE_CURRENCY),
  estSaleAmount: optionalMoney('Estimated sale price'),
  estSaleCurrency: z.enum(CURRENCIES).default(BASE_CURRENCY),
  locationId: trimmed.min(1, 'Choose a location.'),
  notes: optionalText(2000),
})
export type WatchCreateInput = z.infer<typeof watchCreateSchema>

export const watchUpdateSchema = watchCreateSchema.partial().extend({
  id: trimmed.min(1),
  /** Optimistic-concurrency token read when the form was opened. */
  version: z.coerce.number().int().positive(),
  status: z.enum(WATCH_STATUSES).optional(),
})
export type WatchUpdateInput = z.infer<typeof watchUpdateSchema>

export const watchMoveSchema = z.object({
  watchIds: z.array(trimmed.min(1)).min(1, 'Select at least one watch.').max(200),
  toLocationId: trimmed.min(1, 'Choose a destination.'),
  reason: optionalText(300),
})

export const watchPriceSchema = z.object({
  id: trimmed.min(1),
  estSaleAmount: money('Estimated sale price'),
  estSaleCurrency: z.enum(CURRENCIES).default(BASE_CURRENCY),
})

export const saleCreateSchema = z.object({
  watchId: trimmed.min(1),
  invoiceNo: trimmed.min(1, 'Invoice number is required.').max(40),
  saleDate: z.coerce.date({ invalid_type_error: 'Enter a valid sale date.' })
    .max(new Date(Date.now() + 86_400_000), 'Sale date cannot be in the future.'),
  /** The amount as actually agreed, in the currency it was agreed in. */
  saleAmount: money('Sale amount'),
  saleCurrency: z.enum(CURRENCIES).default(BASE_CURRENCY),
  channel: z.enum(SALE_CHANNELS).default('RETAIL'),
  /**
   * Who bought it. Required in substance if not in schema — the quick-sell path
   * asks for it, because "who has this watch now?" is the first question when
   * one comes back and the ledger could not previously answer it.
   */
  customerName: optionalText(120),
  customerCompany: optionalText(160),
  customerEmail: z.union([emailSchema, z.literal('')]).optional().transform((v) => (v ? v : null)),
  customerPhone: optionalText(40),
  customerCountry: optionalText(80),
  /**
   * The customer record this sale belongs to.
   *
   * Optional, and the free-text fields above stay: a walk-in paying cash may
   * leave nothing behind, and sales recorded before the customer book existed
   * must keep reading correctly. When it is set, the name fields are filled
   * from the record rather than typed twice.
   */
  customerId: z.string().trim().optional().or(z.literal('')).transform((v) => v || null),
  /** The pipeline deal this closes, if the sale came from one. */
  dealId: z.string().trim().optional().or(z.literal('')).transform((v) => v || null),
  /**
   * A buyer who is not on the book yet.
   *
   * Filling these in creates the customer record and links the sale to it.
   * Capturing a name against a sale and nowhere else is how a ledger and a
   * customer book end up describing the same person and agreeing on nothing.
   */
  buyerFirstName: optionalText(80),
  buyerLastName: optionalText(80),
  buyerCountry: optionalText(60),
  buyerTier: z.enum(CUSTOMER_TIERS).default('STANDARD'),
  buyerType: z.enum(CUSTOMER_TYPES).default('RETAIL'),
  buyerLeadSource: z.enum(LEAD_SOURCES).default('UNKNOWN'),
  paymentStatus: z.enum(PAYMENT_STATUSES).default('PAID'),
  deliveryStatus: z.enum(DELIVERY_STATUSES).default('COLLECTED'),
  depositGbp: z.union([money('Deposit'), z.literal('')]).optional()
    .transform((v) => (typeof v === 'number' ? v : null)),
  notes: optionalText(1000),
})
export type SaleCreateInput = z.infer<typeof saleCreateSchema>

// --- Reference data --------------------------------------------------------

/**
 * A supplier as a counterparty.
 *
 * Only the trading name is required. Everything else is what you need to raise
 * a purchase order, pay an invoice and know who you are actually contracting
 * with — but demanding it up front would break the one-keystroke "add supplier"
 * from the watch form, and the paperwork usually arrives after the watch does.
 */
export const supplierSchema = z.object({
  name: trimmed.min(1, 'Supplier name is required.').max(120),
  legalName: optionalText(160),
  entityType: z.enum(ENTITY_TYPES).default('UNKNOWN'),
  registrationNo: optionalText(60),
  vatNo: optionalText(40),
  website: optionalText(200),

  contactName: optionalText(120),
  contactRole: optionalText(120),
  contactEmail: z.union([emailSchema, z.literal('')]).optional().transform((v) => (v ? v : null)),
  contactPhone: optionalText(40),

  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(80),
  postcode: optionalText(20),
  country: optionalText(80),

  paymentTerms: z.enum(PAYMENT_TERMS).default('UNKNOWN'),
  defaultCurrency: z.enum(CURRENCIES).default(BASE_CURRENCY),

  notes: optionalText(1000),
  isActive: z.coerce.boolean().default(true),
})

export const locationSchema = z.object({
  name: trimmed.min(1, 'Location name is required.').max(120),
  type: z.enum(LOCATION_TYPES).default('STORE'),
  addressLine: optionalText(200),
  city: optionalText(80),
  country: optionalText(80),
  notes: optionalText(1000),
  isActive: z.coerce.boolean().default(true),
})

// --- Users & settings ------------------------------------------------------

export const userCreateSchema = z.object({
  name: trimmed.min(1, 'Name is required.').max(120),
  email: emailSchema,
  role: z.enum(ROLES),
  jobTitle: optionalText(120),
  phone: optionalText(40),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
})

export const userUpdateSchema = z.object({
  id: trimmed.min(1),
  name: trimmed.min(1, 'Name is required.').max(120).optional(),
  role: z.enum(ROLES).optional(),
  jobTitle: optionalText(120),
  phone: optionalText(40),
  isActive: z.coerce.boolean().optional(),
})

export const preferencesSchema = z.object({
  theme: z.enum(THEMES).optional(),
  density: z.enum(DENSITIES).optional(),
  displayCurrency: z.enum(CURRENCIES).optional(),
  defaultLocationId: z.union([trimmed.min(1), z.literal('')]).optional().transform((v) => (v ? v : null)),
  emailNotifications: z.coerce.boolean().optional(),
  inAppNotifications: z.coerce.boolean().optional(),
})

export const settingsSchema = z.record(z.string().max(64), z.string().max(500))

// --- List query ------------------------------------------------------------

export const WATCH_SORT_FIELDS = [
  'stockNo', 'model', 'purchaseDate', 'purchasePriceGbp', 'estSaleUsd', 'status', 'location', 'margin',
] as const
export type WatchSortField = (typeof WATCH_SORT_FIELDS)[number]

export const watchQuerySchema = z.object({
  /**
   * V2 filter clauses, already parsed and validated by src/lib/filters.ts.
   *
   * Passed through rather than re-parsed: the grammar has one parser, and a
   * second one living in the query schema is a second set of rules to keep in
   * agreement with the first.
   */
  f: z.array(z.custom<FilterClause>()).optional(),

  q: z.string().trim().max(120).optional(),
  status: z.array(z.enum(WATCH_STATUSES)).optional(),
  locationId: z.array(z.string()).optional(),
  supplierId: z.array(z.string()).optional(),
  brandId: z.array(z.string()).optional(),
  /** Only watches with no estimated sale price set. */
  unpricedOnly: z.coerce.boolean().optional(),
  purchasedFrom: z.coerce.date().optional(),
  purchasedTo: z.coerce.date().optional(),
  minPriceGbp: z.coerce.number().optional(),
  maxPriceGbp: z.coerce.number().optional(),
  sort: z.enum(WATCH_SORT_FIELDS).default('stockNo'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(10).max(200).default(25),
  includeDeleted: z.coerce.boolean().default(false),
})
export type WatchQuery = z.infer<typeof watchQuerySchema>

/** Flatten a ZodError into `{ field: message }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

/**
 * Money arriving from a form already grouped as "12,500.00".
 *
 * The money inputs format as you type, so by the time a value reaches here it
 * carries separators. Stripping them beats asking the user to delete them.
 */
const moneyFromText = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    if (!value) return null
    const cleaned = value.replace(/[^0-9.]/g, '')
    if (!cleaned) return null
    return Math.round(Number(cleaned) * 100)
  })
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), 'Enter an amount.')

export const customerSchema = z.object({
  firstName: z.string().trim().min(1, 'A first name is required.').max(80),
  lastName: z.string().trim().min(1, 'A surname is required.').max(80),
  company: optionalText(120),
  email: z.string().trim().email('That does not look like an email address.').optional().or(z.literal('')).transform((v) => v || null),
  phone: optionalText(40),
  altPhone: optionalText(40),
  country: optionalText(60),
  city: optionalText(60),
  addressLine1: optionalText(120),
  addressLine2: optionalText(120),
  postcode: optionalText(20),
  preferredChannel: z.enum(CONTACT_CHANNELS).default('EMAIL'),
  tier: z.enum(CUSTOMER_TIERS).default('STANDARD'),
  customerType: z.enum(CUSTOMER_TYPES).default('RETAIL'),
  status: z.enum(CUSTOMER_STATUSES).default('ACTIVE'),
  // Trade only. A private buyer has none of these and is never asked.
  paymentTerms: z.enum(PAYMENT_TERMS).default('UNKNOWN'),
  creditLimitGbp: moneyFromText,
  vatNo: optionalText(40),
  registrationNo: optionalText(40),
  supplierId: z.string().trim().optional().or(z.literal('')).transform((v) => v || null),
  leadSource: z.enum(LEAD_SOURCES).default('UNKNOWN'),
  budgetMinGbp: moneyFromText,
  budgetMaxGbp: moneyFromText,
  birthday: z.string().trim().optional().or(z.literal('')).transform((v) => v || null),
  notes: optionalText(4000),
  riskNotes: optionalText(2000),
  marketingConsent: z.coerce.boolean().default(false),
  ownerId: z.string().trim().optional().or(z.literal('')).transform((v) => v || null),
  brandIds: z.array(z.string()).optional().default([]),
}).refine(
  (v) => v.budgetMinGbp === null || v.budgetMaxGbp === null || v.budgetMaxGbp >= v.budgetMinGbp,
  { message: 'The top of the budget cannot be below the bottom.', path: ['budgetMaxGbp'] },
)
export type CustomerInput = z.infer<typeof customerSchema>

export const CUSTOMER_SORT_FIELDS = ['name', 'value', 'lastContact', 'created'] as const

export const customerQuerySchema = z.object({
  f: z.array(z.custom<FilterClause>()).optional(),
  q: z.string().trim().max(120).optional(),
  tier: z.array(z.enum(CUSTOMER_TIERS)).optional(),
  customerType: z.array(z.enum(CUSTOMER_TYPES)).optional(),
  status: z.array(z.enum(CUSTOMER_STATUSES)).optional(),
  leadSource: z.array(z.enum(LEAD_SOURCES)).optional(),
  ownerId: z.array(z.string()).optional(),
  sort: z.enum(CUSTOMER_SORT_FIELDS).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(10).max(200).default(25),
})
export type CustomerQuery = z.infer<typeof customerQuerySchema>

export const dealSchema = z.object({
  title: z.string().trim().min(1, 'Give the deal a name you would recognise in a list.').max(140),
  customerId: z.string().trim().optional().or(z.literal('')).transform((v) => v || null),
  watchId: z.string().trim().optional().or(z.literal('')).transform((v) => v || null),
  stage: z.enum(DEAL_STAGES).default('ENQUIRY'),
  valueGbp: moneyFromText,
  probability: z.coerce.number().int().min(0).max(100).optional(),
  expectedClose: z.string().trim().optional().or(z.literal('')).transform((v) => v || null),
  ownerId: z.string().trim().optional().or(z.literal('')).transform((v) => v || null),
  source: z.enum(LEAD_SOURCES).default('UNKNOWN'),
  notes: optionalText(4000),
})
export type DealInput = z.infer<typeof dealSchema>

export const dealQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  stage: z.array(z.enum(DEAL_STAGES)).optional(),
  ownerId: z.array(z.string()).optional(),
  openOnly: z.coerce.boolean().default(false),
})
export type DealQuery = z.infer<typeof dealQuerySchema>

export const activitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES).default('NOTE'),
  direction: z.enum(ACTIVITY_DIRECTIONS).default('OUTBOUND'),
  subject: optionalText(160),
  body: optionalText(8000),
  occurredAt: z.string().trim().optional().or(z.literal('')).transform((v) => (v ? new Date(v) : new Date())),
  durationMin: z.coerce.number().int().min(0).max(1440).optional(),
  customerId: z.string().optional().or(z.literal('')).transform((v) => v || null),
  supplierId: z.string().optional().or(z.literal('')).transform((v) => v || null),
  watchId: z.string().optional().or(z.literal('')).transform((v) => v || null),
  dealId: z.string().optional().or(z.literal('')).transform((v) => v || null),
  requestId: z.string().optional().or(z.literal('')).transform((v) => v || null),
})
export type ActivityInput = z.infer<typeof activitySchema>

export const taskSchema = z.object({
  title: z.string().trim().min(1, 'What needs doing?').max(160),
  notes: optionalText(4000),
  kind: z.enum(TASK_KINDS).default('FOLLOW_UP'),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  dueAt: z.string().trim().optional().or(z.literal('')).transform((v) => (v ? new Date(v) : null)),
  assigneeId: z.string().optional().or(z.literal('')).transform((v) => v || null),
  customerId: z.string().optional().or(z.literal('')).transform((v) => v || null),
  supplierId: z.string().optional().or(z.literal('')).transform((v) => v || null),
  watchId: z.string().optional().or(z.literal('')).transform((v) => v || null),
  dealId: z.string().optional().or(z.literal('')).transform((v) => v || null),
  requestId: z.string().optional().or(z.literal('')).transform((v) => v || null),
})
export type TaskInput = z.infer<typeof taskSchema>

export const taskQuerySchema = z.object({
  status: z.array(z.enum(TASK_STATUSES)).optional(),
  assigneeId: z.array(z.string()).optional(),
  dueBefore: z.coerce.date().optional(),
  dueAfter: z.coerce.date().optional(),
  customerId: z.string().optional(),
  dealId: z.string().optional(),
})
export type TaskQuery = z.infer<typeof taskQuerySchema>

export const watchRequestSchema = z.object({
  customerId: z.string().trim().min(1, 'Which customer is asking?'),
  brandId: z.string().trim().optional().or(z.literal('')).transform((v) => v || null),
  model: optionalText(80),
  referenceNo: optionalText(60),
  dial: optionalText(60),
  bracelet: optionalText(60),
  condition: z.enum(CONDITIONS).default('UNKNOWN'),
  boxPapers: z.enum(BOX_PAPERS).default('UNKNOWN'),
  budgetGbp: moneyFromText,
  targetDate: z.string().trim().optional().or(z.literal('')).transform((v) => v || null),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  status: z.enum(REQUEST_STATUSES).default('OPEN'),
  notes: optionalText(2000),
  ownerId: z.string().trim().optional().or(z.literal('')).transform((v) => v || null),
})
export type WatchRequestInput = z.infer<typeof watchRequestSchema>

export const offerSchema = z.object({
  dealId: z.string().optional().or(z.literal('')).transform((v) => v || null),
  customerId: z.string().optional().or(z.literal('')).transform((v) => v || null),
  watchId: z.string().optional().or(z.literal('')).transform((v) => v || null),
  amount: z.string().trim().min(1, 'How much was offered?'),
  currency: z.enum(CURRENCIES).default('GBP'),
  validUntil: z.string().trim().optional().or(z.literal('')).transform((v) => v || null),
  notes: optionalText(2000),
})
export type OfferInput = z.infer<typeof offerSchema>
