'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { login, logout, changePassword } from '@/server/services/auth-service'
import { getSessionUser, requireUser } from '@/server/auth/session'
import { loginSchema, changePasswordSchema, fieldErrors } from '@/lib/validation'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'

export interface ActionState {
  ok: boolean
  message?: string
  errors?: Record<string, string>
  /**
   * The id of the record just created, so a form can navigate straight to it.
   * Creating a customer and then having to find them in a list is the kind of
   * small tax that makes people avoid the system.
   */
  id?: string
}

/**
 * Server actions return a serialisable `ActionState` rather than throwing, so
 * forms can render inline errors via `useFormState` without an error boundary.
 */
export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    redirectTo: formData.get('redirectTo') || undefined,
  })
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    await login(parsed.data)
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message }
    logger.error('login action failed', { error: (error as Error).message })
    return { ok: false, message: 'Something went wrong signing you in. Please try again.' }
  }
  redirect(parsed.data.redirectTo ?? '/')
}

export async function logoutAction(): Promise<void> {
  const user = await getSessionUser()
  if (user) await logout(user.id, user.name)
  redirect('/login')
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  })
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    await changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword)
  } catch (error) {
    if (isAppError(error)) {
      return { ok: false, message: error.message, errors: error.details as Record<string, string> | undefined }
    }
    return { ok: false, message: 'Could not change your password. Please try again.' }
  }
  revalidatePath('/settings/profile')
  return { ok: true, message: 'Password changed. You have been signed out of other devices.' }
}
