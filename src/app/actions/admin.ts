'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability, requireUser } from '@/server/auth/session'
import { createUser, updateUser, deleteUser, resetUserPassword } from '@/server/services/user-service'
import { updateSettings, updatePreferences } from '@/server/services/settings-service'
import { markAllRead, markRead } from '@/server/services/notification-service'
import { userCreateSchema, userUpdateSchema, preferencesSchema, fieldErrors } from '@/lib/validation'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { ActionState } from './auth'
import type { Role } from '@/lib/enums'

function toState(error: unknown, fallback: string): ActionState {
  if (isAppError(error)) {
    return { ok: false, message: error.message, errors: error.details as Record<string, string> | undefined }
  }
  logger.error(fallback, { error: (error as Error).message })
  return { ok: false, message: fallback }
}

// --- Users -----------------------------------------------------------------

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('user:manage')
  const parsed = userCreateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    await createUser({ ...parsed.data, jobTitle: parsed.data.jobTitle, phone: parsed.data.phone }, actor)
    revalidatePath('/settings/users')
    return { ok: true, message: 'User added. Share their password securely — they should change it on first sign-in.' }
  } catch (error) {
    return toState(error, 'Could not add the user.')
  }
}

export async function updateUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('user:manage')
  const parsed = userUpdateSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name') || undefined,
    role: formData.get('role') || undefined,
    jobTitle: formData.get('jobTitle'),
    phone: formData.get('phone'),
    isActive: formData.get('isActive') === 'on' || formData.get('isActive') === 'true',
  })
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    const { id, ...patch } = parsed.data
    await updateUser(id, patch as { role?: Role; name?: string; isActive?: boolean }, actor)
    revalidatePath('/settings/users')
    return { ok: true, message: 'User updated.' }
  } catch (error) {
    return toState(error, 'Could not update the user.')
  }
}

export async function deleteUserAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('user:manage')
  try {
    await deleteUser(id, actor)
    revalidatePath('/settings/users')
    return { ok: true, message: 'User removed and signed out everywhere.' }
  } catch (error) {
    return toState(error, 'Could not remove the user.')
  }
}

export async function resetPasswordAction(id: string, password: string): Promise<ActionState> {
  const actor = await requireCapability('user:manage')
  try {
    await resetUserPassword(id, password, actor)
    return { ok: true, message: 'Password reset. The user has been signed out of every device.' }
  } catch (error) {
    return toState(error, 'Could not reset the password.')
  }
}

// --- Settings and preferences ----------------------------------------------

export async function updateSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('settings:manage')
  const patch = Object.fromEntries(
    [...formData.entries()].filter(([key]) => key.includes('.')).map(([key, value]) => [key, String(value)]),
  )
  try {
    await updateSettings(patch, actor)
    revalidatePath('/settings')
    revalidatePath('/')
    return { ok: true, message: 'Settings saved.' }
  } catch (error) {
    return toState(error, 'Could not save settings.')
  }
}

export async function updatePreferencesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const parsed = preferencesSchema.safeParse({
    theme: formData.get('theme') || undefined,
    density: formData.get('density') || undefined,
    displayCurrency: formData.get('displayCurrency') || undefined,
    defaultLocationId: formData.get('defaultLocationId') ?? undefined,
    emailNotifications: formData.get('emailNotifications') === 'on',
    inAppNotifications: formData.get('inAppNotifications') === 'on',
  })
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    await updatePreferences(user.id, parsed.data)
    revalidatePath('/settings/profile')
    return { ok: true, message: 'Preferences saved.' }
  } catch (error) {
    return toState(error, 'Could not save your preferences.')
  }
}

// --- Notifications ---------------------------------------------------------

export async function markNotificationReadAction(id: string): Promise<ActionState> {
  const user = await requireUser()
  await markRead(id, user.id)
  revalidatePath('/notifications')
  return { ok: true }
}

export async function markAllNotificationsReadAction(): Promise<ActionState> {
  const user = await requireUser()
  const count = await markAllRead(user.id)
  revalidatePath('/notifications')
  return { ok: true, message: count > 0 ? `${count} marked as read.` : 'Nothing unread.' }
}

/** Persist the header currency switch. Silent by design — the UI already switched. */
export async function updateDisplayCurrencyAction(currency: string): Promise<ActionState> {
  const user = await requireUser()
  const parsed = preferencesSchema.safeParse({ displayCurrency: currency })
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }
  try {
    await updatePreferences(user.id, parsed.data)
    return { ok: true }
  } catch (error) {
    return toState(error, 'Could not save your currency preference.')
  }
}

/** Update exchange rates from the currencies settings screen. */
export async function updateRatesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('settings:manage')
  const input: Record<string, number> = {}
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('rate.')) input[key.slice(5)] = Number(value)
  }
  try {
    const { updateRates } = await import('@/server/services/fx-service')
    await updateRates(input, actor)
    revalidatePath('/settings/currencies')
    revalidatePath('/inventory')
    revalidatePath('/')
    return { ok: true, message: 'Exchange rates updated.' }
  } catch (error) {
    return toState(error, 'Could not update the rates.')
  }
}

/**
 * End every session except this one.
 *
 * "Sign out everywhere" that includes the device you are asking from is not
 * what anyone means by it — the reason for pressing this is usually a laptop
 * left somewhere, and being logged out yourself is a punishment for noticing.
 */
export async function signOutOtherDevicesAction(): Promise<ActionState> {
  const user = await requireUser()
  try {
    const { revokeOtherSessions } = await import('@/server/auth/session')
    const ended = await revokeOtherSessions(user.id)
    revalidatePath('/settings/profile')
    return {
      ok: true,
      message: ended === 0
        ? 'This is your only signed-in device.'
        : `Signed out of ${ended} other ${ended === 1 ? 'device' : 'devices'}.`,
    }
  } catch (error) {
    return toState(error, 'Could not sign out the other devices.')
  }
}
