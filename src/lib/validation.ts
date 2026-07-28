import { z } from 'zod'
import {
  BASE_CURRENCY, BOX_PAPERS, CONDITIONS, CURRENCIES, DENSITIES, ENTITY_TYPES,
  LOCATION_TYPES, PAYMENT_TERMS, ROLES, SALE_CHANNELS, THEMES, WATCH_STATUSES,
} from './enums'

/**
 * Request validation.
 *
 * Every server action and API route parses its input through a schema here.
 * Schemas are the single source of truth for shape *and* for the error copy
 * shown to users, so messages stay consistent across the app.
 */

const money = (label: string) =>
  z.coerce.number({ invalid_type_error: `${label} must be a number.` })
    .min(0, `${label} cannot be negative.`)
    .max(100_000_000, `${label} looks too large — please check.`)

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
