import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { brands, locations, sales, suppliers, watches } from '../db/schema'
import { recordAudit } from './audit'
import { diff } from '@/lib/diff'
import { newId, slugify } from '@/lib/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import type { SessionUser } from '../auth/session'
import type { z } from 'zod'
import type { supplierSchema, locationSchema } from '@/lib/validation'

type SupplierInput = z.infer<typeof supplierSchema>
type LocationInput = z.infer<typeof locationSchema>

// --- Suppliers -------------------------------------------------------------

/** Supplier list with the trading history that makes the row useful. */
export async function listSuppliers() {
  return db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      legalName: suppliers.legalName,
      entityType: suppliers.entityType,
      registrationNo: suppliers.registrationNo,
      vatNo: suppliers.vatNo,
      website: suppliers.website,
      contactName: suppliers.contactName,
      contactRole: suppliers.contactRole,
      contactEmail: suppliers.contactEmail,
      contactPhone: suppliers.contactPhone,
      addressLine1: suppliers.addressLine1,
      addressLine2: suppliers.addressLine2,
      city: suppliers.city,
      postcode: suppliers.postcode,
      country: suppliers.country,
      paymentTerms: suppliers.paymentTerms,
      defaultCurrency: suppliers.defaultCurrency,
      isActive: suppliers.isActive,
      notes: suppliers.notes,
      watchCount: count(watches.id),
      totalCostGbp: sql<number>`coalesce(sum(${watches.purchasePriceGbp}), 0)`,
      inStockCount: sql<number>`coalesce(sum(case when ${watches.status} in ('IN_STOCK','RESERVED','SALE_AGREED') then 1 else 0 end), 0)`,
      soldCount: sql<number>`coalesce(sum(case when ${watches.status} = 'SOLD' then 1 else 0 end), 0)`,
    })
    .from(suppliers)
    .leftJoin(watches, and(eq(watches.supplierId, suppliers.id), isNull(watches.deletedAt)))
    .where(isNull(suppliers.deletedAt))
    .groupBy(suppliers.id)
    .orderBy(suppliers.name)
}

export async function createSupplier(input: SupplierInput, actor: SessionUser): Promise<string> {
  return withTransaction(async () => {
    const clash = await db.select({ id: suppliers.id }).from(suppliers)
      .where(and(eq(suppliers.name, input.name), isNull(suppliers.deletedAt))).limit(1)
    if (clash[0]) throw new ConflictError('A supplier with that name already exists.', { name: 'Already in use.' })

    const id = newId('sup')
    await db.insert(suppliers).values({ id, ...input })
    await recordAudit({
      entityType: 'Supplier', entityId: id, action: 'CREATE', actorId: actor.id,
      summary: `Supplier ${input.name} added`,
    })
    return id
  })
}

export async function updateSupplier(id: string, input: Partial<SupplierInput>, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const rows = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1)
    const existing = rows[0]
    if (!existing || existing.deletedAt) throw new NotFoundError('Supplier')

    await db.update(suppliers).set({ ...input, updatedAt: new Date() }).where(eq(suppliers.id, id))
    await recordAudit({
      entityType: 'Supplier', entityId: id, action: 'UPDATE', actorId: actor.id,
      summary: `Supplier ${existing.name} updated`,
      changes: diff(existing, input, [
        'name', 'legalName', 'entityType', 'registrationNo', 'vatNo', 'website',
        'contactName', 'contactRole', 'contactEmail', 'contactPhone',
        'addressLine1', 'addressLine2', 'city', 'postcode', 'country',
        'paymentTerms', 'defaultCurrency', 'notes', 'isActive',
      ]),
    })
  })
}

/**
 * Soft-delete a supplier.
 *
 * Refused while stock still references it — orphaning a watch's provenance
 * would break the audit chain the business depends on.
 */
export async function deleteSupplier(id: string, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const rows = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1)
    const existing = rows[0]
    if (!existing || existing.deletedAt) throw new NotFoundError('Supplier')

    const held = await db.select({ value: count() }).from(watches)
      .where(and(eq(watches.supplierId, id), isNull(watches.deletedAt)))
    if (Number(held[0]?.value ?? 0) > 0) {
      throw new ValidationError(
        `${existing.name} still has ${held[0]!.value} watches against it. Deactivate the supplier instead of deleting it.`,
      )
    }

    await db.update(suppliers).set({ deletedAt: new Date() }).where(eq(suppliers.id, id))
    await recordAudit({
      entityType: 'Supplier', entityId: id, action: 'DELETE', actorId: actor.id,
      summary: `Supplier ${existing.name} deleted`,
    })
  })
}

// --- Locations -------------------------------------------------------------

/** Location list with live stock counts and capital held. */
export async function listLocations() {
  return db
    .select({
      id: locations.id,
      name: locations.name,
      type: locations.type,
      city: locations.city,
      country: locations.country,
      addressLine: locations.addressLine,
      notes: locations.notes,
      isActive: locations.isActive,
      sortOrder: locations.sortOrder,
      watchCount: sql<number>`coalesce(sum(case when ${watches.status} in ('IN_STOCK','RESERVED','SALE_AGREED') then 1 else 0 end), 0)`,
      valueGbp: sql<number>`coalesce(sum(case when ${watches.status} in ('IN_STOCK','RESERVED','SALE_AGREED') then ${watches.purchasePriceGbp} else 0 end), 0)`,
    })
    .from(locations)
    .leftJoin(watches, and(eq(watches.locationId, locations.id), isNull(watches.deletedAt)))
    .where(isNull(locations.deletedAt))
    .groupBy(locations.id)
    .orderBy(locations.sortOrder)
}

export async function createLocation(input: LocationInput, actor: SessionUser): Promise<string> {
  return withTransaction(async () => {
    const slug = slugify(input.name)
    const clash = await db.select({ id: locations.id }).from(locations)
      .where(and(eq(locations.slug, slug), isNull(locations.deletedAt))).limit(1)
    if (clash[0]) throw new ConflictError('A location with that name already exists.', { name: 'Already in use.' })

    const highest = await db.select({ max: sql<number>`coalesce(max(${locations.sortOrder}), 0)` }).from(locations)
    const id = newId('loc')
    await db.insert(locations).values({ id, slug, sortOrder: Number(highest[0]?.max ?? 0) + 1, ...input })
    await recordAudit({
      entityType: 'Location', entityId: id, action: 'CREATE', actorId: actor.id,
      summary: `Location ${input.name} added`,
    })
    return id
  })
}

export async function updateLocation(id: string, input: Partial<LocationInput>, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const rows = await db.select().from(locations).where(eq(locations.id, id)).limit(1)
    const existing = rows[0]
    if (!existing || existing.deletedAt) throw new NotFoundError('Location')

    const patch: Record<string, unknown> = { ...input, updatedAt: new Date() }
    if (input.name && input.name !== existing.name) patch.slug = slugify(input.name)

    await db.update(locations).set(patch).where(eq(locations.id, id))
    await recordAudit({
      entityType: 'Location', entityId: id, action: 'UPDATE', actorId: actor.id,
      summary: `Location ${existing.name} updated`,
      changes: diff(existing, input, ['name', 'type', 'addressLine', 'city', 'country', 'notes', 'isActive']),
    })
  })
}

/** Soft-delete a location. Refused while it still holds stock. */
export async function deleteLocation(id: string, actor: SessionUser): Promise<void> {
  await withTransaction(async () => {
    const rows = await db.select().from(locations).where(eq(locations.id, id)).limit(1)
    const existing = rows[0]
    if (!existing || existing.deletedAt) throw new NotFoundError('Location')

    const held = await db.select({ value: count() }).from(watches)
      .where(and(eq(watches.locationId, id), isNull(watches.deletedAt)))
    if (Number(held[0]?.value ?? 0) > 0) {
      throw new ValidationError(
        `${existing.name} still holds ${held[0]!.value} watches. Move them elsewhere before deleting it.`,
      )
    }

    await db.update(locations).set({ deletedAt: new Date() }).where(eq(locations.id, id))
    await recordAudit({
      entityType: 'Location', entityId: id, action: 'DELETE', actorId: actor.id,
      summary: `Location ${existing.name} deleted`,
    })
  })
}

export { sales }

// --- Find-or-create, for inline creation from the watch form ---------------

/**
 * Return the brand with this name, creating it if absent.
 *
 * Matching is case-insensitive so "Rolex" typed twice with different casing
 * cannot split one brand into two.
 */
export async function createOrFindBrand(
  name: string,
  actor: SessionUser,
): Promise<{ id: string; name: string; created: boolean }> {
  const slug = slugify(name)
  const existing = await db.select({ id: brands.id, name: brands.name }).from(brands)
    .where(eq(brands.slug, slug)).limit(1)
  if (existing[0]) return { ...existing[0], created: false }

  return withTransaction(async () => {
    const id = newId('brd')
    await db.insert(brands).values({ id, name, slug })
    await recordAudit({
      entityType: 'Brand', entityId: id, action: 'CREATE', actorId: actor.id,
      summary: `Brand ${name} added`,
    })
    return { id, name, created: true }
  })
}

/** Return the supplier with this name, creating it if absent. */
export async function createOrFindSupplier(
  name: string,
  actor: SessionUser,
): Promise<{ id: string; name: string; created: boolean }> {
  const existing = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)
    .where(and(eq(suppliers.name, name), isNull(suppliers.deletedAt))).limit(1)
  if (existing[0]) return { ...existing[0], created: false }

  return withTransaction(async () => {
    const id = newId('sup')
    await db.insert(suppliers).values({ id, name })
    await recordAudit({
      entityType: 'Supplier', entityId: id, action: 'CREATE', actorId: actor.id,
      summary: `Supplier ${name} added`,
    })
    return { id, name, created: true }
  })
}
