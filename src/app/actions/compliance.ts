'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import {
  recordIdCheck, recordRegisterCheck, runVatCheck, sweepVatChecks,
  type VatCheckOutcome,
} from '@/server/services/compliance-service'
import { hmrcConfigured } from '@/server/services/vat-check-service'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'

/**
 * The two checks, as things a person can trigger.
 *
 * Both revalidate the inventory list as well as their own page, because the
 * per-watch light is derived from both: confirming one supplier's VAT number
 * turns every watch bought from them green in the same moment.
 */

export interface CheckActionState {
  ok: boolean
  message?: string
  outcome?: VatCheckOutcome
}

/** Ask HMRC about one supplier now, rather than waiting for the sweep. */
export async function runVatCheckAction(supplierId: string): Promise<CheckActionState> {
  const actor = await requireCapability('supplier:manage')

  if (!hmrcConfigured()) {
    return {
      ok: false,
      message: 'HMRC credentials are not configured, so the number cannot be checked automatically. Set HMRC_CLIENT_ID and HMRC_CLIENT_SECRET.',
    }
  }

  try {
    const outcome = await runVatCheck(supplierId, actor)
    revalidatePath('/suppliers')
    revalidatePath('/inventory')

    if (outcome.nameMismatch) {
      return {
        ok: true,
        outcome,
        message: `HMRC holds that number against "${outcome.registeredName}". Confirm it is the same business.`,
      }
    }
    if (outcome.registered) {
      return { ok: true, outcome, message: `Registered with HMRC as ${outcome.registeredName ?? outcome.supplierName}.` }
    }
    return { ok: false, outcome, message: outcome.message ?? `HMRC returned ${outcome.status}.` }
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message }
    logger.error('vat check failed', { supplierId, error: (error as Error).message })
    return { ok: false, message: 'That check could not be run.' }
  }
}

/** Re-check every supplier whose check has lapsed. */
export async function sweepVatChecksAction(): Promise<CheckActionState> {
  const actor = await requireCapability('supplier:manage')

  try {
    const result = await sweepVatChecks(actor)
    revalidatePath('/suppliers')
    revalidatePath('/inventory')

    if (result.skipped) return { ok: false, message: result.skipped }
    if (result.checked === 0) return { ok: true, message: 'Every supplier is checked and in date.' }

    return {
      ok: true,
      message: result.problems.length === 0
        ? `${result.checked} ${result.checked === 1 ? 'supplier' : 'suppliers'} re-checked, all registered.`
        : `${result.checked} re-checked. ${result.problems.length} need${result.problems.length === 1 ? 's' : ''} attention.`,
    }
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message }
    logger.error('vat sweep failed', { error: (error as Error).message })
    return { ok: false, message: 'The sweep could not be run.' }
  }
}

/**
 * Record what The Watch Register said.
 *
 * The person ran the search; this writes down that they did, what they found
 * and when. `watch:update` rather than a capability of its own — recording a
 * check is amending the stock record, and the roles that may do one may do the
 * other.
 */
export async function recordRegisterCheckAction(
  watchId: string,
  status: 'CLEAR' | 'RECORDED',
  reference: string | null,
  notes: string | null,
): Promise<CheckActionState> {
  const actor = await requireCapability('watch:update')

  try {
    await recordRegisterCheck(watchId, { status, reference, notes }, actor)
    revalidatePath('/inventory')
    revalidatePath(`/inventory/${watchId}`)

    return {
      ok: true,
      message: status === 'CLEAR'
        ? 'Recorded as clear on The Watch Register.'
        : 'Recorded as found on the register. This item must not be sold.',
    }
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message }
    logger.error('register check failed', { watchId, error: (error as Error).message })
    return { ok: false, message: 'That check could not be recorded.' }
  }
}

/**
 * Record that somebody has identified the director.
 *
 * `supplier:manage`: accepting identity evidence is the same class of act as
 * changing who the supplier is, and neither belongs to everyone who can read
 * the supplier book.
 */
export async function recordIdCheckAction(
  supplierId: string,
  status: 'VERIFIED' | 'REJECTED',
  documentId: string | null,
  notes: string | null,
): Promise<CheckActionState> {
  const actor = await requireCapability('supplier:manage')

  try {
    await recordIdCheck(supplierId, { status, documentId, notes }, actor)
    revalidatePath('/suppliers')
    revalidatePath('/inventory')

    return {
      ok: true,
      message: status === 'VERIFIED'
        ? 'Identification recorded. It falls due again in six months.'
        : 'Recorded as rejected. This supplier will show red until it is resolved.',
    }
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message }
    logger.error('id check failed', { supplierId, error: (error as Error).message })
    return { ok: false, message: 'That check could not be recorded.' }
  }
}
