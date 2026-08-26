import { sql } from 'drizzle-orm'
import {
  boolean, customType, date, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import {
  ACTIVITY_DIRECTIONS, ACTIVITY_TYPES, AUDIT_ACTIONS, BOX_PAPERS, CONDITIONS, CONTACT_CHANNELS,
  CURRENCIES, CUSTOMER_STATUSES, CUSTOMER_TIERS, CUSTOMER_TYPES, DEAL_STAGES, DELIVERY_STATUSES, DENSITIES,
  ENTITY_TYPES, IMAGE_KINDS, LEAD_SOURCES, LOCATION_TYPES, NOTIFICATION_TYPES, OFFER_STATUSES,
  PAYMENT_STATUSES, PAYMENT_TERMS, PRIORITIES, PRODUCT_TYPES, REQUEST_ENQUIRY_STATUSES, REQUEST_STATUSES,
  ROLES, SALE_CHANNELS, SAVED_VIEW_OBJECTS, TASK_KINDS, TASK_STATUSES, THEMES, WATCH_STATUSES,
} from '@/lib/enums'

/**
 * Schema conventions
 *  - Primary keys are application-generated sortable string ids (see `newId`).
 *  - Money is INTEGER minor units (pence / cents). Never floats. The int4 range
 *    tops out around £21m per row, comfortably above any single watch.
 *  - Enum-like columns are `text` with a TypeScript union, declared once in
 *    src/lib/enums.ts, rather than native pg enums — adding a value is then a
 *    code change with no migration and no lock.
 *  - Destroyable entities carry `deletedAt`; repositories filter it out.
 */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
const deletedAt = () => timestamp('deleted_at', { withTimezone: true })

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------

export const users = pgTable(
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
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
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

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the token; the raw value only ever exists in the cookie. */
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex('sessions_token_idx').on(t.tokenHash),
    userIdx: index('sessions_user_idx').on(t.userId),
    expiryIdx: index('sessions_expiry_idx').on(t.expiresAt),
  }),
)

/**
 * A list somebody set up and wants back tomorrow.
 *
 * The query string is the whole payload — it already carries filters, sort,
 * search and column choices, and it is already the representation that can be
 * pasted into a message. Storing a structured copy alongside it would be
 * storing the same thing twice and inviting the two to disagree.
 */
export const savedViews = pgTable(
  'saved_views',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    object: text('object', { enum: SAVED_VIEW_OBJECTS }).notNull(),
    name: text('name').notNull(),
    query: text('query').notNull(),
    shared: boolean('shared').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    lookupIdx: index('saved_views_lookup_idx').on(t.object, t.userId).where(sql`deleted_at IS NULL`),
  }),
)

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  theme: text('theme', { enum: THEMES }).notNull().default('SYSTEM'),
  density: text('density', { enum: DENSITIES }).notNull().default('COMFORTABLE'),
  displayCurrency: text('display_currency', { enum: CURRENCIES }).notNull().default('GBP'),
  defaultLocationId: text('default_location_id').references(() => locations.id, { onDelete: 'set null' }),
  emailNotifications: boolean('email_notifications').notNull().default(true),
  inAppNotifications: boolean('in_app_notifications').notNull().default(true),
  updatedAt: updatedAt(),
})

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const locations = pgTable(
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
    isActive: boolean('is_active').notNull().default(true),
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

/**
 * A supplier as a counterparty, not a label.
 *
 * Everything beyond the trading name is nullable so a supplier can still be
 * created in one keystroke from the watch form — the detail is filled in when
 * the paperwork arrives, not demanded before the first purchase can be booked.
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: text('id').primaryKey(),
    /** The name the team uses day to day. */
    name: text('name').notNull(),
    /** The entity on the invoice, where it differs from the trading name. */
    legalName: text('legal_name'),
    entityType: text('entity_type', { enum: ENTITY_TYPES }).notNull().default('UNKNOWN'),
    registrationNo: text('registration_no'),
    vatNo: text('vat_no'),
    website: text('website'),

    /** The named individual dealt with. */
    contactName: text('contact_name'),
    contactRole: text('contact_role'),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),

    /** Retained from the original shape; the contact fields supersede these. */
    email: text('email'),
    phone: text('phone'),

    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    postcode: text('postcode'),
    country: text('country'),

    paymentTerms: text('payment_terms', { enum: PAYMENT_TERMS }).notNull().default('UNKNOWN'),
    defaultCurrency: text('default_currency', { enum: CURRENCIES }).notNull().default('GBP'),

    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    nameIdx: uniqueIndex('suppliers_name_idx').on(t.name),
    activeIdx: index('suppliers_active_idx').on(t.isActive),
    countryIdx: index('suppliers_country_idx').on(t.country),
  }),
)

export const brands = pgTable(
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

export const watches = pgTable(
  'watches',
  {
    id: text('id').primaryKey(),
    /** Human-facing stock number carried over from the legacy spreadsheet. */
    stockNo: integer('stock_no').notNull(),

    /**
     * Watch unless somebody says otherwise — see PRODUCT_TYPES. Defaulted in
     * the database as well as in the schema so an insert written without it
     * (the importer, a backfill) cannot land a row with no type at all.
     */
    productType: text('product_type', { enum: PRODUCT_TYPES }).notNull().default('WATCH'),

    brandId: text('brand_id').notNull().references(() => brands.id),
    model: text('model').notNull(),
    nickname: text('nickname'),
    serial: text('serial'),
    condition: text('condition', { enum: CONDITIONS }).notNull().default('UNKNOWN'),
    boxPapers: text('box_papers', { enum: BOX_PAPERS }).notNull().default('UNKNOWN'),
    year: integer('year'),

    supplierId: text('supplier_id').notNull().references(() => suppliers.id),
    purchaseDate: timestamp('purchase_date', { withTimezone: true }).notNull(),
    /** Contractual purchase price, GBP minor units. */
    purchasePriceGbp: integer('purchase_price_gbp').notNull(),
    /** Derived USD minor units at the rate captured on the purchase date. */
    purchasePriceUsd: integer('purchase_price_usd'),
    /** GBP→USD rate at purchase, stored as an integer ×10000. */
    purchaseFxRate: integer('purchase_fx_rate'),

    /** Legacy USD estimate, retained so historic exports still reconcile. */
    estSaleUsd: integer('est_sale_usd'),
    /** Target sale price in GBP minor units — the figure reports aggregate. */
    estSaleGbp: integer('est_sale_gbp'),
    /** The amount and currency actually quoted, preserved as entered. */
    estSaleAmount: integer('est_sale_amount'),
    estSaleCurrency: text('est_sale_currency', { enum: CURRENCIES }).notNull().default('USD'),
    /** The purchase amount and currency as agreed with the supplier. */
    purchaseAmount: integer('purchase_amount'),
    purchaseCurrency: text('purchase_currency', { enum: CURRENCIES }).notNull().default('GBP'),

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
    productTypeIdx: index('watches_product_type_idx').on(t.productType).where(sql`deleted_at IS NULL`),
    purchaseDateIdx: index('watches_purchase_date_idx').on(t.purchaseDate),
    serialIdx: index('watches_serial_idx').on(t.serial),
    statusLocationIdx: index('watches_status_location_idx').on(t.status, t.locationId),
    deletedIdx: index('watches_deleted_idx').on(t.deletedAt),
  }),
)

/** Postgres BYTEA mapped to a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

/**
 * Image bytes stored in the database.
 *
 * Deliberately not object storage: at a few images per watch this avoids a
 * second service and a second set of credentials, and it makes a database
 * backup a complete backup. Uploads are downscaled in the browser first, so
 * rows stay well under a megabyte.
 */
export const watchImages = pgTable(
  'watch_images',
  {
    id: text('id').primaryKey(),
    watchId: text('watch_id').notNull().references(() => watches.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: IMAGE_KINDS }).notNull().default('WATCH'),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    width: integer('width'),
    height: integer('height'),
    data: bytea('data').notNull(),
    caption: text('caption'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({ watchIdx: index('watch_images_watch_idx').on(t.watchId, t.kind, t.sortOrder) }),
)

export const sales = pgTable(
  'sales',
  {
    id: text('id').primaryKey(),
    watchId: text('watch_id').notNull().references(() => watches.id, { onDelete: 'cascade' }),
    invoiceNo: text('invoice_no').notNull(),
    saleDate: timestamp('sale_date', { withTimezone: true }).notNull(),
    saleAmountUsd: integer('sale_amount_usd').notNull(),
    saleAmountGbp: integer('sale_amount_gbp').notNull(),
    saleFxRate: integer('sale_fx_rate'),
    /** The amount and currency the sale was actually agreed in. */
    saleAmount: integer('sale_amount'),
    saleCurrency: text('sale_currency', { enum: CURRENCIES }).notNull().default('USD'),
    customerName: text('customer_name'),
    customerEmail: text('customer_email'),
    customerPhone: text('customer_phone'),
    customerCompany: text('customer_company'),
    customerCountry: text('customer_country'),
    /**
     * The linked customer record, once there is one. `customerName` stays as
     * the fallback: sales recorded before the CRM existed must keep reading
     * correctly rather than becoming anonymous.
     */
    customerId: text('customer_id').references((): AnyPgColumn => customers.id),
    dealId: text('deal_id').references((): AnyPgColumn => deals.id),
    channel: text('channel', { enum: SALE_CHANNELS }).notNull().default('RETAIL'),
    commissionGbp: integer('commission_gbp').notNull().default(0),
    depositGbp: integer('deposit_gbp').notNull().default(0),
    paymentStatus: text('payment_status', { enum: PAYMENT_STATUSES }).notNull().default('PAID'),
    deliveryStatus: text('delivery_status', { enum: DELIVERY_STATUSES }).notNull().default('COLLECTED'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    warrantyMonths: integer('warranty_months'),
    /** Realised profit, denormalised for fast reporting. */
    profitUsd: integer('profit_usd').notNull(),
    profitGbp: integer('profit_gbp').notNull(),
    /** Margin percentage ×100 (840 == 8.40%). */
    marginBps: integer('margin_bps').notNull(),
    notes: text('notes'),
    recordedById: text('recorded_by_id').notNull().references(() => users.id),

    /**
     * A voided sale is kept, not deleted. An invoice that was issued and then
     * cancelled is a fact; reports exclude voided rows so the figures move as
     * if it never completed, while the correction stays explicable.
     */
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: text('voided_by_id').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    /**
     * One *live* sale per watch, and one live sale per invoice number.
     *
     * Both were unqualified unique indexes, written when a sale was a one-way
     * door. Voiding made that false: the watch comes back into stock and is
     * sold again, or the same invoice is re-entered against the right stock
     * number, and the insert failed on a constraint. Drizzle cannot express a
     * partial index, so these are declared in migration 0005 and mirrored here
     * as non-unique so the schema still documents the columns that are
     * indexed.
     */
    watchIdx: index('sales_watch_live_idx').on(t.watchId),
    invoiceIdx: index('sales_invoice_live_idx').on(t.invoiceNo),
    dateIdx: index('sales_date_idx').on(t.saleDate),
    channelIdx: index('sales_channel_idx').on(t.channel),
  }),
)

export const stockMovements = pgTable(
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

export const auditLogs = pgTable(
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

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: NOTIFICATION_TYPES }).notNull(),
    title: text('title').notNull(),
    body: text('body'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    userReadIdx: index('notifications_user_read_idx').on(t.userId, t.readAt),
    createdIdx: index('notifications_created_idx').on(t.createdAt),
  }),
)

/**
 * Exchange rates, expressed as units of `code` per 1 GBP, scaled by 10,000.
 *
 * Rates are entered by hand rather than fetched: the team agrees deals at a
 * rate they choose, and a live feed would silently re-price stock between one
 * page load and the next. `updatedAt` is surfaced in the UI so anyone reading
 * a converted figure can see how stale it is.
 */
export const fxRates = pgTable('fx_rates', {
  code: text('code', { enum: CURRENCIES }).primaryKey(),
  ratePerGbp: integer('rate_per_gbp').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedById: text('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
})

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: updatedAt(),
})

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

/**
 * A customer.
 *
 * The dealership's other half. Everything here exists to answer a question
 * somebody asks out loud: who wants this watch, what did we last say to them,
 * and what has this relationship been worth.
 */
export const customers = pgTable(
  'customers',
  {
    id: text('id').primaryKey(),
    /** Human-quotable reference, e.g. C-0142. */
    reference: text('reference').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    company: text('company'),
    email: text('email'),
    phone: text('phone'),
    altPhone: text('alt_phone'),
    country: text('country'),
    city: text('city'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    postcode: text('postcode'),
    preferredChannel: text('preferred_channel', { enum: CONTACT_CHANNELS }).notNull().default('EMAIL'),
    language: text('language'),
    tier: text('tier', { enum: CUSTOMER_TIERS }).notNull().default('STANDARD'),
    /** Which side of the business they belong to: trade (B2B) or retail (B2C). */
    customerType: text('customer_type', { enum: CUSTOMER_TYPES }).notNull().default('RETAIL'),
    /**
     * Trade terms. A dealer buys against terms and a credit position rather
     * than a budget, and needs the paperwork a company needs.
     */
    paymentTerms: text('payment_terms', { enum: PAYMENT_TERMS }).notNull().default('UNKNOWN'),
    creditLimitGbp: integer('credit_limit_gbp'),
    vatNo: text('vat_no'),
    registrationNo: text('registration_no'),
    /** The same firm on the buying side, when a dealer both buys and sells. */
    supplierId: text('supplier_id').references((): AnyPgColumn => suppliers.id),
    leadSource: text('lead_source', { enum: LEAD_SOURCES }).notNull().default('UNKNOWN'),
    status: text('status', { enum: CUSTOMER_STATUSES }).notNull().default('ACTIVE'),
    /** Budget as a range in GBP minor units; a ceiling alone reads as a promise. */
    budgetMinGbp: integer('budget_min_gbp'),
    budgetMaxGbp: integer('budget_max_gbp'),
    birthday: date('birthday'),
    notes: text('notes'),
    riskNotes: text('risk_notes'),
    marketingConsent: boolean('marketing_consent').notNull().default(false),
    consentRecordedAt: timestamp('consent_recorded_at', { withTimezone: true }),
    ownerId: text('owner_id').references(() => users.id),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    referenceIdx: uniqueIndex('customers_reference_idx').on(t.reference).where(sql`deleted_at IS NULL`),
    nameIdx: index('customers_name_idx').on(t.lastName, t.firstName),
    emailIdx: index('customers_email_idx').on(t.email),
    phoneIdx: index('customers_phone_idx').on(t.phone),
    ownerIdx: index('customers_owner_idx').on(t.ownerId),
    typeIdx: index('customers_type_idx').on(t.customerType).where(sql`deleted_at IS NULL`),
    supplierIdx: index('customers_supplier_idx').on(t.supplierId),
  }),
)

/** Which brands a customer actually buys, so "who wants a Patek?" is a query. */
export const customerBrands = pgTable(
  'customer_brands',
  {
    customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.customerId, t.brandId] }) }),
)

export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    tone: text('tone').notNull().default('neutral'),
    createdAt: createdAt(),
  },
  (t) => ({ labelIdx: uniqueIndex('tags_label_idx').on(sql`lower(${t.label})`) }),
)

/** One tag vocabulary, attached to whichever entity wants it. */
export const entityTags = pgTable(
  'entity_tags',
  {
    tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tagId, t.entityType, t.entityId] }),
    entityIdx: index('entity_tags_entity_idx').on(t.entityType, t.entityId),
  }),
)

/** The named people at a supplier, rather than one contact field per company. */
export const supplierContacts = pgTable(
  'supplier_contacts',
  {
    id: text('id').primaryKey(),
    supplierId: text('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role'),
    email: text('email'),
    phone: text('phone'),
    isPrimary: boolean('is_primary').notNull().default(false),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({ supplierIdx: index('supplier_contacts_supplier_idx').on(t.supplierId) }),
)

/**
 * A deal: the sale before it is a sale.
 *
 * Winning one hands over to the `sales` ledger rather than duplicating it, so
 * revenue keeps a single source of truth.
 */
export const deals = pgTable(
  'deals',
  {
    id: text('id').primaryKey(),
    reference: text('reference').notNull(),
    title: text('title').notNull(),
    customerId: text('customer_id').references(() => customers.id),
    watchId: text('watch_id').references(() => watches.id),
    stage: text('stage', { enum: DEAL_STAGES }).notNull().default('ENQUIRY'),
    valueGbp: integer('value_gbp'),
    probability: integer('probability').notNull().default(20),
    expectedClose: date('expected_close'),
    ownerId: text('owner_id').references(() => users.id),
    source: text('source', { enum: LEAD_SOURCES }).notNull().default('UNKNOWN'),
    notes: text('notes'),
    lostReason: text('lost_reason'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    stageChangedAt: timestamp('stage_changed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Position within its column, so a hand-ordered board survives a refresh. */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    referenceIdx: uniqueIndex('deals_reference_idx').on(t.reference).where(sql`deleted_at IS NULL`),
    stageIdx: index('deals_stage_idx').on(t.stage).where(sql`deleted_at IS NULL`),
    customerIdx: index('deals_customer_idx').on(t.customerId),
    watchIdx: index('deals_watch_idx').on(t.watchId),
    ownerIdx: index('deals_owner_idx').on(t.ownerId),
  }),
)

export const dealStageEvents = pgTable(
  'deal_stage_events',
  {
    id: text('id').primaryKey(),
    dealId: text('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
    fromStage: text('from_stage', { enum: DEAL_STAGES }),
    toStage: text('to_stage', { enum: DEAL_STAGES }).notNull(),
    actorId: text('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ dealIdx: index('deal_stage_events_deal_idx').on(t.dealId, t.createdAt) }),
)

/** What was actually put to the customer, and what came back. */
export const offers = pgTable(
  'offers',
  {
    id: text('id').primaryKey(),
    dealId: text('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    customerId: text('customer_id').references(() => customers.id),
    watchId: text('watch_id').references(() => watches.id),
    amount: integer('amount').notNull(),
    currency: text('currency', { enum: CURRENCIES }).notNull().default('GBP'),
    amountGbp: integer('amount_gbp').notNull(),
    status: text('status', { enum: OFFER_STATUSES }).notNull().default('SENT'),
    validUntil: date('valid_until'),
    notes: text('notes'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    dealIdx: index('offers_deal_idx').on(t.dealId),
    customerIdx: index('offers_customer_idx').on(t.customerId),
    watchIdx: index('offers_watch_idx').on(t.watchId),
  }),
)

/** Demand you do not yet hold: what a customer is waiting for. */
export const watchRequests = pgTable(
  'watch_requests',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    brandId: text('brand_id').references(() => brands.id),
    model: text('model'),
    referenceNo: text('reference_no'),
    dial: text('dial'),
    bracelet: text('bracelet'),
    condition: text('condition', { enum: CONDITIONS }).notNull().default('UNKNOWN'),
    boxPapers: text('box_papers', { enum: BOX_PAPERS }).notNull().default('UNKNOWN'),
    budgetGbp: integer('budget_gbp'),
    targetDate: date('target_date'),
    priority: text('priority', { enum: PRIORITIES }).notNull().default('NORMAL'),
    status: text('status', { enum: REQUEST_STATUSES }).notNull().default('OPEN'),
    notes: text('notes'),
    ownerId: text('owner_id').references(() => users.id),
    fulfilledBy: text('fulfilled_by').references(() => watches.id),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    customerIdx: index('watch_requests_customer_idx').on(t.customerId),
    statusIdx: index('watch_requests_status_idx').on(t.status).where(sql`deleted_at IS NULL`),
    brandIdx: index('watch_requests_brand_idx').on(t.brandId),
  }),
)

/** Who was asked to find it, and what they said. */
export const requestEnquiries = pgTable(
  'request_enquiries',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull().references(() => watchRequests.id, { onDelete: 'cascade' }),
    supplierId: text('supplier_id').references(() => suppliers.id),
    status: text('status', { enum: REQUEST_ENQUIRY_STATUSES }).notNull().default('SENT'),
    quotedGbp: integer('quoted_gbp'),
    notes: text('notes'),
    actorId: text('actor_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ requestIdx: index('request_enquiries_request_idx').on(t.requestId) }),
)

/**
 * One timeline primitive.
 *
 * Calls, emails, WhatsApp, meetings, notes and the system's own events are all
 * rows here, each pointing at whichever entities it concerns. Six separate
 * feeds is how a CRM becomes something people stop reading.
 */
export const activities = pgTable(
  'activities',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ACTIVITY_TYPES }).notNull(),
    direction: text('direction', { enum: ACTIVITY_DIRECTIONS }).notNull().default('OUTBOUND'),
    subject: text('subject'),
    body: text('body'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    durationMin: integer('duration_min'),
    customerId: text('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
    supplierId: text('supplier_id').references(() => suppliers.id, { onDelete: 'cascade' }),
    watchId: text('watch_id').references(() => watches.id, { onDelete: 'cascade' }),
    dealId: text('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    requestId: text('request_id').references(() => watchRequests.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => users.id),
    /** Written by the application, and rendered quieter than a real conversation. */
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    customerIdx: index('activities_customer_idx').on(t.customerId, t.occurredAt),
    supplierIdx: index('activities_supplier_idx').on(t.supplierId, t.occurredAt),
    watchIdx: index('activities_watch_idx').on(t.watchId, t.occurredAt),
    dealIdx: index('activities_deal_idx').on(t.dealId, t.occurredAt),
    recentIdx: index('activities_recent_idx').on(t.occurredAt),
  }),
)

/** The follow-up that otherwise lives in somebody's head. */
export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    notes: text('notes'),
    kind: text('kind', { enum: TASK_KINDS }).notNull().default('FOLLOW_UP'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('OPEN'),
    priority: text('priority', { enum: PRIORITIES }).notNull().default('NORMAL'),
    assigneeId: text('assignee_id').references(() => users.id),
    customerId: text('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
    supplierId: text('supplier_id').references(() => suppliers.id, { onDelete: 'cascade' }),
    watchId: text('watch_id').references(() => watches.id, { onDelete: 'cascade' }),
    dealId: text('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    requestId: text('request_id').references(() => watchRequests.id, { onDelete: 'cascade' }),
    /**
     * The rule that generated this task. Unique, so a rule that fires every
     * night produces one reminder rather than one per night.
     */
    autoKey: text('auto_key'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: text('completed_by').references(() => users.id),
    createdBy: text('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    autoKeyIdx: uniqueIndex('tasks_auto_key_idx').on(t.autoKey).where(sql`auto_key IS NOT NULL`),
    openIdx: index('tasks_open_idx').on(t.status, t.dueAt).where(sql`deleted_at IS NULL`),
    assigneeIdx: index('tasks_assignee_idx').on(t.assigneeId, t.status),
    customerIdx: index('tasks_customer_idx').on(t.customerId),
    dealIdx: index('tasks_deal_idx').on(t.dealId),
  }),
)

void sql

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
export type WatchImage = typeof watchImages.$inferSelect
export type Sale = typeof sales.$inferSelect
export type NewSale = typeof sales.$inferInsert
export type StockMovement = typeof stockMovements.$inferSelect
export type AuditLog = typeof auditLogs.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type AppSetting = typeof appSettings.$inferSelect
export type FxRate = typeof fxRates.$inferSelect
export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
export type SupplierContact = typeof supplierContacts.$inferSelect
export type Deal = typeof deals.$inferSelect
export type NewDeal = typeof deals.$inferInsert
export type Offer = typeof offers.$inferSelect
export type WatchRequest = typeof watchRequests.$inferSelect
export type NewWatchRequest = typeof watchRequests.$inferInsert
export type RequestEnquiry = typeof requestEnquiries.$inferSelect
export type Activity = typeof activities.$inferSelect
export type NewActivity = typeof activities.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type Tag = typeof tags.$inferSelect
