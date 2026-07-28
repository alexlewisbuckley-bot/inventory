import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import {
  AUDIT_ACTIONS, BOX_PAPERS, CONDITIONS, CURRENCIES, DENSITIES, LOCATION_TYPES,
  NOTIFICATION_TYPES, ROLES, SALE_CHANNELS, THEMES, WATCH_STATUSES,
} from '@/lib/enums'

/**
 * Schema conventions
 *  - Primary keys are application-generated CUID-ish strings (see `newId`).
 *  - Money is INTEGER minor units (pence / cents). Never floats.
 *  - Timestamps are INTEGER unix-millis, surfaced as JS `Date` by the driver.
 *  - Destroyable entities carry `deletedAt`; repositories filter it out.
 */

const now = sql`(unixepoch() * 1000)`
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now)
const deletedAt = () => integer('deleted_at', { mode: 'timestamp_ms' })

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ROLES }).notNull().default('STAFF'),
    jobTitle: text('job_title'),
    phone: text('phone'),
    initials: text('initials').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
    /** Bumped on password change so every previously issued session dies. */
    tokenVersion: integer('token_version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
    roleIdx: index('users_role_idx').on(t.role),
    activeIdx: index('users_active_idx').on(t.isActive),
  }),
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the token; the raw value only ever exists in the cookie. */
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => ({
    tokenIdx: uniqueIndex('sessions_token_idx').on(t.tokenHash),
    userIdx: index('sessions_user_idx').on(t.userId),
    expiryIdx: index('sessions_expiry_idx').on(t.expiresAt),
  }),
)

export const userPreferences = sqliteTable('user_preferences', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  theme: text('theme', { enum: THEMES }).notNull().default('SYSTEM'),
  density: text('density', { enum: DENSITIES }).notNull().default('COMFORTABLE'),
  displayCurrency: text('display_currency', { enum: CURRENCIES }).notNull().default('GBP'),
  defaultLocationId: text('default_location_id').references(() => locations.id, { onDelete: 'set null' }),
  emailNotifications: integer('email_notifications', { mode: 'boolean' }).notNull().default(true),
  inAppNotifications: integer('in_app_notifications', { mode: 'boolean' }).notNull().default(true),
  updatedAt: updatedAt(),
})

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const locations = sqliteTable(
  'locations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    type: text('type', { enum: LOCATION_TYPES }).notNull().default('STORE'),
    addressLine: text('address_line'),
    city: text('city'),
    country: text('country'),
    notes: text('notes'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    slugIdx: uniqueIndex('locations_slug_idx').on(t.slug),
    activeIdx: index('locations_active_idx').on(t.isActive),
  }),
)

export const suppliers = sqliteTable(
  'suppliers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    email: text('email'),
    phone: text('phone'),
    country: text('country'),
    notes: text('notes'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    nameIdx: uniqueIndex('suppliers_name_idx').on(t.name),
    activeIdx: index('suppliers_active_idx').on(t.isActive),
  }),
)

export const brands = sqliteTable(
  'brands',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({ slugIdx: uniqueIndex('brands_slug_idx').on(t.slug) }),
)

// ---------------------------------------------------------------------------
// Core inventory
// ---------------------------------------------------------------------------

export const watches = sqliteTable(
  'watches',
  {
    id: text('id').primaryKey(),
    /** Human-facing stock number carried over from the legacy spreadsheet. */
    stockNo: integer('stock_no').notNull(),

    brandId: text('brand_id').notNull().references(() => brands.id),
    model: text('model').notNull(),
    nickname: text('nickname'),
    serial: text('serial'),
    condition: text('condition', { enum: CONDITIONS }).notNull().default('UNKNOWN'),
    boxPapers: text('box_papers', { enum: BOX_PAPERS }).notNull().default('UNKNOWN'),
    year: integer('year'),

    supplierId: text('supplier_id').notNull().references(() => suppliers.id),
    purchaseDate: integer('purchase_date', { mode: 'timestamp_ms' }).notNull(),
    /** Contractual purchase price, GBP minor units. */
    purchasePriceGbp: integer('purchase_price_gbp').notNull(),
    /** Derived USD minor units at the rate captured on the purchase date. */
    purchasePriceUsd: integer('purchase_price_usd'),
    /** GBP→USD rate at purchase, stored as an integer ×10000. */
    purchaseFxRate: integer('purchase_fx_rate'),

    /** Target sale price, USD minor units. NULL means "not yet priced". */
    estSaleUsd: integer('est_sale_usd'),

    locationId: text('location_id').notNull().references(() => locations.id),
    status: text('status', { enum: WATCH_STATUSES }).notNull().default('IN_STOCK'),

    notes: text('notes'),
    createdById: text('created_by_id').notNull().references(() => users.id),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    /** Optimistic-concurrency guard, incremented on every write. */
    version: integer('version').notNull().default(1),
  },
  (t) => ({
    stockNoIdx: uniqueIndex('watches_stock_no_idx').on(t.stockNo),
    statusIdx: index('watches_status_idx').on(t.status),
    locationIdx: index('watches_location_idx').on(t.locationId),
    supplierIdx: index('watches_supplier_idx').on(t.supplierId),
    brandIdx: index('watches_brand_idx').on(t.brandId),
    purchaseDateIdx: index('watches_purchase_date_idx').on(t.purchaseDate),
    serialIdx: index('watches_serial_idx').on(t.serial),
    statusLocationIdx: index('watches_status_location_idx').on(t.status, t.locationId),
    deletedIdx: index('watches_deleted_idx').on(t.deletedAt),
  }),
)

export const watchPhotos = sqliteTable(
  'watch_photos',
  {
    id: text('id').primaryKey(),
    watchId: text('watch_id').notNull().references(() => watches.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    caption: text('caption'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => ({ watchIdx: index('watch_photos_watch_idx').on(t.watchId) }),
)

export const sales = sqliteTable(
  'sales',
  {
    id: text('id').primaryKey(),
    watchId: text('watch_id').notNull().references(() => watches.id, { onDelete: 'cascade' }),
    invoiceNo: text('invoice_no').notNull(),
    saleDate: integer('sale_date', { mode: 'timestamp_ms' }).notNull(),
    saleAmountUsd: integer('sale_amount_usd').notNull(),
    saleAmountGbp: integer('sale_amount_gbp').notNull(),
    saleFxRate: integer('sale_fx_rate'),
    customerName: text('customer_name'),
    customerEmail: text('customer_email'),
    channel: text('channel', { enum: SALE_CHANNELS }).notNull().default('RETAIL'),
    /** Realised profit, denormalised for fast reporting. */
    profitUsd: integer('profit_usd').notNull(),
    profitGbp: integer('profit_gbp').notNull(),
    /** Margin percentage ×100 (840 == 8.40%). */
    marginBps: integer('margin_bps').notNull(),
    notes: text('notes'),
    recordedById: text('recorded_by_id').notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    watchIdx: uniqueIndex('sales_watch_idx').on(t.watchId),
    invoiceIdx: uniqueIndex('sales_invoice_idx').on(t.invoiceNo),
    dateIdx: index('sales_date_idx').on(t.saleDate),
    channelIdx: index('sales_channel_idx').on(t.channel),
  }),
)

export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: text('id').primaryKey(),
    watchId: text('watch_id').notNull().references(() => watches.id, { onDelete: 'cascade' }),
    fromLocationId: text('from_location_id').references(() => locations.id),
    toLocationId: text('to_location_id').notNull().references(() => locations.id),
    reason: text('reason'),
    movedById: text('moved_by_id').notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({
    watchIdx: index('stock_movements_watch_idx').on(t.watchId),
    createdIdx: index('stock_movements_created_idx').on(t.createdAt),
  }),
)

// ---------------------------------------------------------------------------
// Observability & platform
// ---------------------------------------------------------------------------

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action', { enum: AUDIT_ACTIONS }).notNull(),
    /** JSON-encoded `{ field: { from, to } }` diff. */
    changes: text('changes'),
    summary: text('summary'),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    ipAddress: text('ip_address'),
    createdAt: createdAt(),
  },
  (t) => ({
    entityIdx: index('audit_entity_idx').on(t.entityType, t.entityId),
    actorIdx: index('audit_actor_idx').on(t.actorId),
    createdIdx: index('audit_created_idx').on(t.createdAt),
  }),
)

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: NOTIFICATION_TYPES }).notNull(),
    title: text('title').notNull(),
    body: text('body'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    readAt: integer('read_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => ({
    userReadIdx: index('notifications_user_read_idx').on(t.userId, t.readAt),
    createdIdx: index('notifications_created_idx').on(t.createdAt),
  }),
)

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: updatedAt(),
})

// --- Inferred model types --------------------------------------------------

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Session = typeof sessions.$inferSelect
export type UserPreference = typeof userPreferences.$inferSelect
export type Location = typeof locations.$inferSelect
export type NewLocation = typeof locations.$inferInsert
export type Supplier = typeof suppliers.$inferSelect
export type NewSupplier = typeof suppliers.$inferInsert
export type Brand = typeof brands.$inferSelect
export type Watch = typeof watches.$inferSelect
export type NewWatch = typeof watches.$inferInsert
export type WatchPhoto = typeof watchPhotos.$inferSelect
export type Sale = typeof sales.$inferSelect
export type NewSale = typeof sales.$inferInsert
export type StockMovement = typeof stockMovements.$inferSelect
export type AuditLog = typeof auditLogs.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type AppSetting = typeof appSettings.$inferSelect
