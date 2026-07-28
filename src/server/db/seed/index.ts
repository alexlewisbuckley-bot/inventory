/**
 * Idempotent seed.
 *
 * Populates reference data, demo users and the 26 real watches migrated from
 * "ChronoHub Spreadsheet 1.xlsx". Running it twice is safe — every insert is
 * guarded by an existence check — so it doubles as a bootstrap for a fresh
 * environment and a top-up for an existing one.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { db, connection, withTransaction } from '../client'
import { runMigrations } from '../migrate'
import {
  appSettings, auditLogs, brands, locations, notifications, sales,
  stockMovements, suppliers, userPreferences, users, watches,
} from '../schema'
import { hashPassword } from '../../auth/password'
import { newId, initialsOf, slugify } from '@/lib/ids'
import type { Role } from '@/lib/enums'

interface SeedWatch {
  stockNo: number; brand: string; model: string; nickname: string | null
  serial: string | null; purchasePriceGbp: number; purchasePriceUsd: number | null
  supplier: string; purchaseDate: string; estSaleUsd: number | null
}

const DEFAULT_FX = 1.33

const SEED_USERS: Array<{ email: string; name: string; role: Role; jobTitle: string; password: string }> = [
  { email: 'alex@bluecroft.co.uk', name: 'Alex Buckley', role: 'OWNER', jobTitle: 'Director', password: 'Bluecroft2026!' },
  { email: 'sarah@bluecroft.co.uk', name: 'Sarah Whitfield', role: 'MANAGER', jobTitle: 'Head of Stock', password: 'Bluecroft2026!' },
  { email: 'omar@bluecroft.co.uk', name: 'Omar Haddad', role: 'STAFF', jobTitle: 'Sales Associate — Dubai', password: 'Bluecroft2026!' },
  { email: 'priya@bluecroft.co.uk', name: 'Priya Nair', role: 'VIEWER', jobTitle: 'Finance', password: 'Bluecroft2026!' },
]

const SEED_LOCATIONS = [
  { name: 'One Street Watches', type: 'STORE' as const, city: 'Dubai', country: 'United Arab Emirates', sortOrder: 1, notes: 'Retail showroom — display stock.' },
  { name: 'Chrono Hub', type: 'STORE' as const, city: 'Dubai', country: 'United Arab Emirates', sortOrder: 2, notes: 'Retail showroom — display stock.' },
  { name: 'Own inventory', type: 'VAULT' as const, city: 'Manchester', country: 'United Kingdom', sortOrder: 3, notes: 'Head office safe. Not on display.' },
  { name: 'In transit', type: 'TRANSIT' as const, city: null, country: null, sortOrder: 4, notes: 'Between locations — courier or staff carry.' },
]

const SETTINGS: Record<string, string> = {
  'company.name': 'Bluecroft Finance',
  'company.tradingName': 'Bluecroft Stock',
  'finance.baseCurrency': 'GBP',
  'finance.fxGbpUsd': String(DEFAULT_FX),
  'finance.targetMarginPct': '8',
  'inventory.ageingWarningDays': '90',
  'inventory.stockNoStart': '1400',
}

export async function seed(): Promise<void> {
  runMigrations()

  await withTransaction(async () => {
    // --- Users -------------------------------------------------------------
    const userIds = new Map<string, string>()
    for (const spec of SEED_USERS) {
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, spec.email))
      if (existing[0]) { userIds.set(spec.email, existing[0].id); continue }
      const id = newId('usr')
      await db.insert(users).values({
        id, email: spec.email, name: spec.name, role: spec.role, jobTitle: spec.jobTitle,
        initials: initialsOf(spec.name), passwordHash: await hashPassword(spec.password), isActive: true,
      })
      await db.insert(userPreferences).values({ userId: id })
      userIds.set(spec.email, id)
    }
    const ownerId = userIds.get('alex@bluecroft.co.uk')!
    const managerId = userIds.get('sarah@bluecroft.co.uk')!

    // --- Locations ---------------------------------------------------------
    const locationIds = new Map<string, string>()
    for (const spec of SEED_LOCATIONS) {
      const slug = slugify(spec.name)
      const existing = await db.select({ id: locations.id }).from(locations).where(eq(locations.slug, slug))
      if (existing[0]) { locationIds.set(spec.name, existing[0].id); continue }
      const id = newId('loc')
      await db.insert(locations).values({ id, slug, ...spec })
      locationIds.set(spec.name, id)
    }

    // --- Watches, brands and suppliers -------------------------------------
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), 'src/server/db/seed/watches.json'), 'utf8'),
    ) as SeedWatch[]

    const brandIds = new Map<string, string>()
    const supplierIds = new Map<string, string>()

    for (const name of new Set(raw.map((w) => w.brand))) {
      const slug = slugify(name)
      const existing = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, slug))
      if (existing[0]) { brandIds.set(name, existing[0].id); continue }
      const id = newId('brd')
      await db.insert(brands).values({ id, name, slug })
      brandIds.set(name, id)
    }

    const SUPPLIER_META: Record<string, { country: string; contactName: string }> = {
      'GB Luxury Limited': { country: 'United Kingdom', contactName: 'Trade desk' },
      'Dad Dad Watches': { country: 'United Kingdom', contactName: 'Private seller' },
    }
    for (const name of new Set(raw.map((w) => w.supplier))) {
      const existing = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, name))
      if (existing[0]) { supplierIds.set(name, existing[0].id); continue }
      const id = newId('sup')
      await db.insert(suppliers).values({ id, name, ...(SUPPLIER_META[name] ?? {}) })
      supplierIds.set(name, id)
    }

    // Spread stock across locations deterministically so the demo data shows
    // a realistic distribution rather than everything sitting in one place.
    const spread = ['One Street Watches', 'Own inventory', 'Chrono Hub']

    for (const [index, w] of raw.entries()) {
      const existing = await db.select({ id: watches.id }).from(watches).where(eq(watches.stockNo, w.stockNo))
      if (existing[0]) continue

      const fx = w.purchasePriceUsd && w.purchasePriceGbp
        ? Math.round((w.purchasePriceUsd / w.purchasePriceGbp) * 10_000)
        : Math.round(DEFAULT_FX * 10_000)

      const id = newId('wch')
      const locationName = spread[index % spread.length]!
      await db.insert(watches).values({
        id,
        stockNo: w.stockNo,
        brandId: brandIds.get(w.brand)!,
        model: w.model,
        nickname: w.nickname,
        serial: w.serial,
        supplierId: supplierIds.get(w.supplier)!,
        purchaseDate: new Date(`${w.purchaseDate}T00:00:00.000Z`),
        purchasePriceGbp: w.purchasePriceGbp,
        purchasePriceUsd: w.purchasePriceUsd ?? Math.round(w.purchasePriceGbp * DEFAULT_FX),
        purchaseFxRate: fx,
        estSaleUsd: w.estSaleUsd,
        locationId: locationIds.get(locationName)!,
        status: 'IN_STOCK',
        condition: 'EXCELLENT',
        boxPapers: index % 3 === 0 ? 'FULL_SET' : 'WATCH_ONLY',
        createdById: ownerId,
      })
      await db.insert(stockMovements).values({
        id: newId('mov'), watchId: id, fromLocationId: null,
        toLocationId: locationIds.get(locationName)!,
        reason: 'Initial intake from supplier', movedById: ownerId,
      })
      await db.insert(auditLogs).values({
        id: newId('aud'), entityType: 'Watch', entityId: id, action: 'CREATE',
        summary: `Stock ${w.stockNo} — ${w.brand} ${w.model} added from ${w.supplier}`,
        actorId: ownerId,
      })
    }

    // --- Settings ----------------------------------------------------------
    for (const [key, value] of Object.entries(SETTINGS)) {
      await db.insert(appSettings).values({ key, value }).onConflictDoNothing()
    }

    // --- A welcome notification for each user ------------------------------
    for (const userId of userIds.values()) {
      const existing = await db.select({ id: notifications.id }).from(notifications)
        .where(eq(notifications.userId, userId)).limit(1)
      if (existing[0]) continue
      await db.insert(notifications).values({
        id: newId('ntf'), userId, type: 'SYSTEM',
        title: 'Welcome to Bluecroft Stock',
        body: 'Your inventory has been migrated from the shared spreadsheet. 26 watches are now tracked.',
      })
    }

    void managerId
    void sales
  })
}

// Executed directly via `npm run db:seed`.
if (process.argv[1]?.includes('seed')) {
  seed()
    .then(() => {
      const count = connection.prepare('SELECT COUNT(*) as c FROM watches').get() as { c: number }
      console.log(`Seed complete — ${count.c} watches in stock.`)
      console.log('Sign in with alex@bluecroft.co.uk / Bluecroft2026!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Seed failed:', error)
      process.exit(1)
    })
}

void sql
