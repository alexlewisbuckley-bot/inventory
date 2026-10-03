'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { TRADE_ENQUIRY_KINDS, type TradeEnquiryKind } from '@/lib/enums'
import type { ActionState } from './auth'

function toState(error: unknown, fallback: string): ActionState {
  if (isAppError(error)) return { ok: false, message: error.message }
  logger.error('trade enquiry action failed', { error: (error as Error).message })
  return { ok: false, message: fallback }
}

function refresh(id?: string): void {
  revalidatePath('/enquiries')
  if (id) revalidatePath(`/enquiries/${id}`)
  revalidatePath('/notifications')
}

/**
 * A dealer, on the catalogue, saying they want something.
 *
 * Rate limited on the mutation bucket like any other write: a dealer pressing
 * the button twenty times should meet a wall rather than an owner's phone.
 */
export async function raiseEnquiryAction(input: {
  watchId: string
  kind: string
  offerGbp: number | null
  message: string | null
}): Promise<ActionState> {
  const actor = await requireCapability('trade:enquire')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const kind: TradeEnquiryKind = (TRADE_ENQUIRY_KINDS as readonly string[]).includes(input.kind)
    ? (input.kind as TradeEnquiryKind)
    : 'INTEREST'

  try {
    const { raiseEnquiry } = await import('@/server/services/trade-enquiry-service')
    const id = await raiseEnquiry({
      watchId: input.watchId,
      kind,
      offerGbp: input.offerGbp,
      message: input.message?.trim() || null,
    }, actor)
    refresh(id)
    revalidatePath('/catalogue')
    return { ok: true, id, message: 'Sent. We will come back to you here.' }
  } catch (error) {
    return toState(error, 'Could not send that.')
  }
}

/** A line in the thread, from either side. */
export async function replyToEnquiryAction(enquiryId: string, body: string): Promise<ActionState> {
  // Either door: the dealer who raised it, or the owner answering it. The
  // service decides which side the author is on and who to tell.
  const actor = await requireCapability('trade:enquire').catch(() => requireCapability('trade:respond'))
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  try {
    const { addMessage } = await import('@/server/services/trade-enquiry-service')
    await addMessage(enquiryId, body, actor)
    refresh(enquiryId)
    return { ok: true, message: 'Sent.' }
  } catch (error) {
    return toState(error, 'Could not send that.')
  }
}

/**
 * The answer, and the only thing here that puts a deal on the board.
 *
 * The owner's alone, which is the gate the whole shape exists for.
 */
export async function decideEnquiryAction(
  enquiryId: string,
  decision: 'APPROVED' | 'DECLINED',
  note: string | null,
): Promise<ActionState> {
  const actor = await requireCapability('trade:respond')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  try {
    const { decideEnquiry } = await import('@/server/services/trade-enquiry-service')
    const { dealId } = await decideEnquiry(enquiryId, decision, note?.trim() || null, actor)
    refresh(enquiryId)
    revalidatePath('/deals')
    return {
      ok: true,
      id: dealId ?? undefined,
      message: decision === 'APPROVED' ? 'Approved, and a deal is on the board.' : 'Declined.',
    }
  } catch (error) {
    return toState(error, 'Could not record that.')
  }
}
