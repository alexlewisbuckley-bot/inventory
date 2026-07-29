'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import {
  createActivity, createCustomer, createDeal, createOffer, createRequest, createTask,
  completeTask, deleteCustomer, deleteDeal, moveDeal, recordEnquiry, respondToOffer,
  updateCustomer, updateDeal, updateRequestStatus, updateTask,
} from '@/server/services/crm-service'
import { getRateTable } from '@/server/services/fx-service'
import { toBase } from '@/lib/currency'
import {
  activitySchema, customerSchema, dealSchema, fieldErrors, offerSchema, taskSchema,
  watchRequestSchema,
} from '@/lib/validation'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { DEAL_STAGES, REQUEST_STATUSES, type DealStage } from '@/lib/enums'
import type { ActionState } from './auth'

/**
 * CRM server actions.
 *
 * Each one revalidates every screen the change is visible on rather than only
 * the page it was fired from: a logged call changes the customer record, the
 * dashboard's "quiet VIPs" list and the deal it was about, and a stale one of
 * those is how people stop trusting what they are reading.
 */

function toState(error: unknown, fallback: string): ActionState {
  if (isAppError(error)) {
    return { ok: false, message: error.message, errors: error.details as Record<string, string> | undefined }
  }
  logger.error(fallback, { error: (error as Error).message })
  return { ok: false, message: fallback }
}

const revalidateCrm = (extra: string[] = []) => {
  for (const path of ['/crm', '/customers', '/pipeline', '/tasks', '/requests', '/', ...extra]) {
    revalidatePath(path)
  }
}

// --- Customers -------------------------------------------------------------

export async function saveCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = formData.get('id')?.toString() || null
  const actor = await requireCapability(id ? 'customer:update' : 'customer:create')

  const parsed = customerSchema.safeParse({
    ...Object.fromEntries(formData.entries()),
    marketingConsent: formData.get('marketingConsent') === 'on' || formData.get('marketingConsent') === 'true',
    brandIds: formData.getAll('brandIds').map(String).filter(Boolean),
  })
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    if (id) {
      await updateCustomer(id, parsed.data, actor)
      revalidateCrm([`/customers/${id}`])
      return { ok: true, message: 'Customer updated.' }
    }
    const newCustomerId = await createCustomer(parsed.data, actor)
    revalidateCrm([`/customers/${newCustomerId}`])
    return { ok: true, message: 'Customer added.', id: newCustomerId }
  } catch (error) {
    return toState(error, 'Could not save the customer.')
  }
}

export async function deleteCustomerAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('customer:delete')
  try {
    await deleteCustomer(id, actor)
    revalidateCrm()
    return { ok: true, message: 'Customer removed.' }
  } catch (error) {
    return toState(error, 'Could not remove the customer.')
  }
}

// --- Deals -----------------------------------------------------------------

export async function saveDealAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = formData.get('id')?.toString() || null
  const actor = await requireCapability(id ? 'deal:update' : 'deal:create')

  const parsed = dealSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    if (id) {
      await updateDeal(id, parsed.data, actor)
      revalidateCrm([`/pipeline/${id}`])
      return { ok: true, message: 'Deal updated.' }
    }
    const dealId = await createDeal(parsed.data, actor)
    revalidateCrm([`/pipeline/${dealId}`])
    return { ok: true, message: 'Deal opened.', id: dealId }
  } catch (error) {
    return toState(error, 'Could not save the deal.')
  }
}

/**
 * Move a deal on the board.
 *
 * Called from a drag, so it takes the stage and the new position together —
 * two round trips would let the board show an order the server disagrees with.
 */
export async function moveDealAction(
  id: string, stage: string, options: { lostReason?: string; sortOrder?: number } = {},
): Promise<ActionState> {
  const actor = await requireCapability('deal:update')
  if (!DEAL_STAGES.includes(stage as DealStage)) {
    return { ok: false, message: 'That is not a stage on this board.' }
  }
  try {
    await moveDeal(id, stage as DealStage, actor, {
      lostReason: options.lostReason ?? null,
      sortOrder: options.sortOrder,
    })
    revalidateCrm([`/pipeline/${id}`])
    return { ok: true, message: 'Deal moved.' }
  } catch (error) {
    return toState(error, 'Could not move the deal.')
  }
}

export async function deleteDealAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('deal:delete')
  try {
    await deleteDeal(id, actor)
    revalidateCrm()
    return { ok: true, message: 'Deal deleted.' }
  } catch (error) {
    return toState(error, 'Could not delete the deal.')
  }
}

// --- Activities ------------------------------------------------------------

export async function logActivityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('activity:create')
  const parsed = activitySchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    await createActivity(parsed.data, actor)
    const extra = [
      parsed.data.customerId ? `/customers/${parsed.data.customerId}` : null,
      parsed.data.watchId ? `/inventory/${parsed.data.watchId}` : null,
      parsed.data.supplierId ? '/suppliers' : null,
    ].filter(Boolean) as string[]
    revalidateCrm(extra)
    return { ok: true, message: 'Logged.' }
  } catch (error) {
    return toState(error, 'Could not log that.')
  }
}

// --- Tasks -----------------------------------------------------------------

export async function saveTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = formData.get('id')?.toString() || null
  const actor = await requireCapability(id ? 'task:update' : 'task:create')
  const parsed = taskSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    if (id) await updateTask(id, parsed.data, actor)
    else await createTask(parsed.data, actor)
    revalidateCrm([
      parsed.data.customerId ? `/customers/${parsed.data.customerId}` : '/tasks',
    ])
    return { ok: true, message: id ? 'Task updated.' : 'Task added.' }
  } catch (error) {
    return toState(error, 'Could not save the task.')
  }
}

export async function completeTaskAction(id: string, done: boolean): Promise<ActionState> {
  const actor = await requireCapability('task:update')
  try {
    await completeTask(id, done, actor)
    revalidateCrm()
    return { ok: true, message: done ? 'Done.' : 'Reopened.' }
  } catch (error) {
    return toState(error, 'Could not update the task.')
  }
}

// --- Watch requests --------------------------------------------------------

export async function saveRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('request:create')
  const parsed = watchRequestSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    const id = await createRequest(parsed.data, actor)
    revalidateCrm([`/customers/${parsed.data.customerId}`])
    return { ok: true, message: 'Request registered.', id }
  } catch (error) {
    return toState(error, 'Could not register the request.')
  }
}

export async function setRequestStatusAction(id: string, status: string): Promise<ActionState> {
  const actor = await requireCapability('request:update')
  if (!REQUEST_STATUSES.includes(status as never)) {
    return { ok: false, message: 'That is not a status a request can have.' }
  }
  try {
    await updateRequestStatus(id, status as never, actor)
    revalidateCrm()
    return { ok: true, message: 'Request updated.' }
  } catch (error) {
    return toState(error, 'Could not update the request.')
  }
}

export async function recordEnquiryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('request:update')
  const requestId = formData.get('requestId')?.toString()
  if (!requestId) return { ok: false, message: 'Which request is this about?' }

  const quoted = formData.get('quotedGbp')?.toString().replace(/[^0-9.]/g, '')
  try {
    await recordEnquiry({
      requestId,
      supplierId: formData.get('supplierId')?.toString() || null,
      status: (formData.get('status')?.toString() || 'SENT') as never,
      quotedGbp: quoted ? Math.round(Number(quoted) * 100) : null,
      notes: formData.get('notes')?.toString() || null,
    }, actor)
    revalidateCrm()
    return { ok: true, message: 'Enquiry recorded.' }
  } catch (error) {
    return toState(error, 'Could not record the enquiry.')
  }
}

// --- Offers ----------------------------------------------------------------

export async function createOfferAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('deal:update')
  const parsed = offerSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    // Offers are made in whatever currency the conversation is happening in;
    // the GBP figure is derived once, here, so every report can add them up.
    const rates = await getRateTable()
    const minor = Math.round(Number(parsed.data.amount.replace(/[^0-9.]/g, '')) * 100)
    const amountGbp = toBase(minor, parsed.data.currency, rates)

    await createOffer(parsed.data, amountGbp, actor)
    revalidateCrm([
      parsed.data.customerId ? `/customers/${parsed.data.customerId}` : '/pipeline',
      parsed.data.watchId ? `/inventory/${parsed.data.watchId}` : '/pipeline',
    ])
    return { ok: true, message: 'Offer recorded.' }
  } catch (error) {
    return toState(error, 'Could not record the offer.')
  }
}

export async function respondToOfferAction(id: string, status: string): Promise<ActionState> {
  const actor = await requireCapability('deal:update')
  if (!['ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'].includes(status)) {
    return { ok: false, message: 'That is not a response an offer can have.' }
  }
  try {
    await respondToOffer(id, status as never, actor)
    revalidateCrm()
    return { ok: true, message: `Offer ${status.toLowerCase()}.` }
  } catch (error) {
    return toState(error, 'Could not update the offer.')
  }
}
