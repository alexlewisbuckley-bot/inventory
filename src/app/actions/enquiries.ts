'use server'
import { recordEnquiry } from '@/server/services/reseller-service'
import { enquirySchema, fieldErrors } from '@/lib/validation'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { ActionState } from './auth'

/**
 * The one action in this application anybody on the internet can call.
 *
 * No session, by design: a reseller's customer is not a user here. Everything
 * it needs comes from the shop token, which is checked inside the service
 * rather than trusted from the form — a hidden field is a suggestion, not a
 * credential.
 *
 * Rate limited on the token. Somebody who has the link can post to this, so
 * the ceiling is what stops one of them filling the table overnight.
 */
export async function submitEnquiryAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = formData.get('token')?.toString() ?? ''
  const watchId = formData.get('watchId')?.toString() ?? ''

  const parsed = enquirySchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    message: formData.get('message'),
  })
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    rateLimit({ key: `enquiry:${token}`, ...LIMITS.enquiry })
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message }
    return { ok: false, message: 'Too many enquiries just now. Please try again shortly.' }
  }

  try {
    const result = await recordEnquiry(token, watchId, parsed.data)
    if (!result.ok) {
      return { ok: false, message: 'That piece is no longer available. Please choose another.' }
    }
    // Delivered or not, the enquiry is recorded — so the customer is told it
    // has been received either way. Whether the email left the building is the
    // reseller's problem to see, not something to worry a buyer with.
    return {
      ok: true,
      message: 'Thank you — your enquiry has been sent. We will be in touch shortly.',
    }
  } catch (error) {
    logger.error('enquiry failed', { error: (error as Error).message })
    return { ok: false, message: 'Something went wrong sending that. Please try again.' }
  }
}
