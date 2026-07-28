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
  const parsed = supplierSchema.safeParse({
    name: formData.get('name'),
    contactName: formData.get('contactName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    country: formData.get('country'),
    notes: formData.get('notes'),
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
