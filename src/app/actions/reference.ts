'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import {
  createSupplier, updateSupplier, deleteSupplier,
  createLocation, updateLocation, deleteLocation,
} from '@/server/services/reference-service'
import { supplierSchema, locationSchema, fieldErrors } from '@/lib/validation'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { ActionState } from './auth'

function toState(error: unknown, fallback: string): ActionState {
  if (isAppError(error)) {
    return { ok: false, message: error.message, errors: error.details as Record<string, string> | undefined }
  }
  logger.error(fallback, { error: (error as Error).message })
  return { ok: false, message: fallback }
}

// --- Suppliers -------------------------------------------------------------

export async function saveSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('supplier:manage')
  const id = formData.get('id')?.toString() || null
  // Read the whole form rather than naming each field: the supplier record now
  // has eighteen of them, and picking them off one at a time is how a field
  // silently stops being saved when it is added to the form.
  const parsed = supplierSchema.safeParse({
    ...Object.fromEntries(formData.entries()),
    isActive: formData.get('isActive') === 'on' || formData.get('isActive') === 'true',
  })
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    if (id) await updateSupplier(id, parsed.data, actor)
    else await createSupplier(parsed.data, actor)
    revalidatePath('/suppliers')
    return { ok: true, message: id ? 'Supplier updated.' : 'Supplier added.' }
  } catch (error) {
    return toState(error, 'Could not save the supplier.')
  }
}

export async function deleteSupplierAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('supplier:manage')
  try {
    await deleteSupplier(id, actor)
    revalidatePath('/suppliers')
    return { ok: true, message: 'Supplier deleted.' }
  } catch (error) {
    return toState(error, 'Could not delete the supplier.')
  }
}

// --- Locations -------------------------------------------------------------

export async function saveLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('location:manage')
  const id = formData.get('id')?.toString() || null
  const parsed = locationSchema.safeParse({
    name: formData.get('name'),
    type: formData.get('type'),
    addressLine: formData.get('addressLine'),
    city: formData.get('city'),
    country: formData.get('country'),
    notes: formData.get('notes'),
    isActive: formData.get('isActive') === 'on' || formData.get('isActive') === 'true',
  })
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    if (id) await updateLocation(id, parsed.data, actor)
    else await createLocation(parsed.data, actor)
    revalidatePath('/locations')
    revalidatePath('/inventory')
    return { ok: true, message: id ? 'Location updated.' : 'Location added.' }
  } catch (error) {
    return toState(error, 'Could not save the location.')
  }
}

export async function deleteLocationAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('location:manage')
  try {
    await deleteLocation(id, actor)
    revalidatePath('/locations')
    return { ok: true, message: 'Location deleted.' }
  } catch (error) {
    return toState(error, 'Could not delete the location.')
  }
}

// --- Inline creation from the watch form -----------------------------------

/**
 * Create a brand from within the add-watch form.
 *
 * Returns the new id so the calling form can select it immediately, rather
 * than sending the user to another page and losing what they had typed.
 * Matching an existing brand case-insensitively avoids "Rolex" and "rolex"
 * becoming two brands.
 */
export async function createBrandAction(name: string): Promise<ActionState & { id?: string; name?: string }> {
  const actor = await requireCapability('watch:create')
  const trimmed = name.trim()
  if (trimmed.length < 1) return { ok: false, message: 'Enter a brand name.' }
  if (trimmed.length > 80) return { ok: false, message: 'That brand name is too long.' }

  try {
    const { createOrFindBrand } = await import('@/server/services/reference-service')
    const brand = await createOrFindBrand(trimmed, actor)
    revalidatePath('/inventory/new')
    return { ok: true, id: brand.id, name: brand.name, message: brand.created ? `Added ${brand.name}.` : undefined }
  } catch (error) {
    return toState(error, 'Could not add that brand.')
  }
}

/** Create a supplier from within the add-watch form. */
export async function createSupplierInlineAction(name: string): Promise<ActionState & { id?: string; name?: string }> {
  const actor = await requireCapability('watch:create')
  const trimmed = name.trim()
  if (trimmed.length < 1) return { ok: false, message: 'Enter a supplier name.' }
  if (trimmed.length > 120) return { ok: false, message: 'That supplier name is too long.' }

  try {
    const { createOrFindSupplier } = await import('@/server/services/reference-service')
    const supplier = await createOrFindSupplier(trimmed, actor)
    revalidatePath('/inventory/new')
    revalidatePath('/suppliers')
    return { ok: true, id: supplier.id, name: supplier.name, message: supplier.created ? `Added ${supplier.name}.` : undefined }
  } catch (error) {
    return toState(error, 'Could not add that supplier.')
  }
}
