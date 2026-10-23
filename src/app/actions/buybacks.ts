'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireCapability } from '@/server/auth/session'
import { describeDbError, isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { CURRENCIES } from '@/lib/enums'
import {
  addExtensionFee, defaultBuyback, markChargePaid, recordBuyback, redeemBuyback, voidCharge,
} from '@/server/services/buyback-service'
import type { ActionState } from './auth'

function toState(error: unknown, fallback: string): ActionState {
  if (isAppError(error)) {
    return { ok: false, message: error.message, errors: error.details as Record<string, string> | undefined }
  }
  const described = describeDbError(error)
  if (described) return { ok: false, message: described }
  logger.error('buyback action failed', { error: (error as Error).message })
  return { ok: false, message: fallback }
}

/**
 * Everything a buy-back moves.
 *
 * The loans page, the ledger it earns into, and every report that adds the
 * interest up. One function so the next screen that reads them is added
 * here once rather than being forgotten in six places — the same mistake
 * that left the reports showing yesterday's figures after a sale.
 */
function refreshBuybacks(): void {
  revalidatePath('/buybacks')
  revalidatePath('/sales')
  revalidatePath('/today')
  revalidatePath('/reports')
  revalidatePath('/reports/people')
  revalidatePath('/reports/pnl')
  revalidatePath('/inventory')
}

const itemSchema = z.object({
  description: z.string().trim().min(1, 'Say what it is.'),
  brand: z.string().trim().nullish(),
  model: z.string().trim().nullish(),
  serial: z.string().trim().nullish(),
  year: z.coerce.number().int().min(1900).max(2100).nullish(),
  agreedAmount: z.coerce.number().int().min(0).nullish(),
})

const buybackSchema = z.object({
  reference: z.string().trim().nullish(),
  customerId: z.string().trim().nullish(),
  customerName: z.string().trim().min(1, 'Who did you lend to?'),
  principalAmount: z.coerce.number().int().positive('Enter what you lent.'),
  principalCurrency: z.enum(CURRENCIES),
  /** The monthly rate in basis points: 250 is two and a half percent. */
  rateBps: z.coerce.number().int().min(0).max(100_000),
  startedOn: z.coerce.date(),
  dueOn: z.coerce.date().nullish(),
  soldById: z.string().trim().nullish(),
  notes: z.string().trim().nullish(),
  items: z.array(itemSchema).min(1, 'Add what is securing it.'),
})

export async function recordBuybackAction(input: unknown): Promise<ActionState & { id?: string }> {
  const actor = await requireCapability('buyback:write')
  const parsed = buybackSchema.safeParse(input)
  if (!parsed.success) {
    const errors: Record<string, string> = {}
    for (const issue of parsed.error.issues) errors[issue.path.join('.')] = issue.message
    return { ok: false, message: 'Check the highlighted fields.', errors }
  }

  try {
    const id = await recordBuyback({
      ...parsed.data,
      items: parsed.data.items.map((item) => ({
        ...item,
        brand: item.brand ?? null,
        model: item.model ?? null,
        serial: item.serial ?? null,
        year: item.year ?? null,
        agreedAmount: item.agreedAmount ?? null,
      })),
      dueOn: parsed.data.dueOn ?? null,
    }, actor)
    refreshBuybacks()
    return { ok: true, message: 'Buy-back recorded.', id }
  } catch (error) {
    return toState(error, 'Could not record the buy-back.')
  }
}

export async function markBuybackChargePaidAction(chargeId: string): Promise<ActionState> {
  const actor = await requireCapability('buyback:write')
  try {
    await markChargePaid(chargeId, actor)
    refreshBuybacks()
    return { ok: true, message: 'Marked as paid.' }
  } catch (error) {
    return toState(error, 'Could not record the payment.')
  }
}

export async function voidBuybackChargeAction(chargeId: string, reason: string): Promise<ActionState> {
  const actor = await requireCapability('buyback:write')
  try {
    await voidCharge(chargeId, reason, actor)
    refreshBuybacks()
    return { ok: true, message: 'Charge voided.' }
  } catch (error) {
    return toState(error, 'Could not void the charge.')
  }
}

export async function addExtensionFeeAction(input: {
  buybackId: string
  amount: number
  currency: string
  dueOn: string
  newDueOn?: string | null
  notes?: string | null
}): Promise<ActionState> {
  const actor = await requireCapability('buyback:write')
  const schema = z.object({
    buybackId: z.string().min(1),
    amount: z.coerce.number().int().positive('Enter the fee.'),
    currency: z.enum(CURRENCIES),
    dueOn: z.coerce.date(),
    newDueOn: z.coerce.date().nullish(),
    notes: z.string().trim().nullish(),
  })
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Check the fee and the date.' }

  try {
    await addExtensionFee({ ...parsed.data, newDueOn: parsed.data.newDueOn ?? null }, actor)
    refreshBuybacks()
    return { ok: true, message: 'Extension fee charged.' }
  } catch (error) {
    return toState(error, 'Could not charge the extension fee.')
  }
}

export async function redeemBuybackAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('buyback:write')
  try {
    await redeemBuyback(id, actor)
    refreshBuybacks()
    return { ok: true, message: 'Redeemed. The watches go back to the customer.' }
  } catch (error) {
    return toState(error, 'Could not close the buy-back.')
  }
}

/**
 * They did not redeem, so the watches are ours.
 *
 * The one action here that creates stock, which is why the message says
 * how many: somebody pressing this is committing to the watches being on
 * the book at what was lent against them, and that is worth seeing
 * confirmed rather than inferring from the inventory count later.
 */
export async function defaultBuybackAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('buyback:write')
  try {
    const created = await defaultBuyback(id, actor)
    refreshBuybacks()
    return {
      ok: true,
      message: `Defaulted. ${created.length} watch${created.length === 1 ? '' : 'es'} taken into stock at the loan value.`,
    }
  } catch (error) {
    return toState(error, 'Could not default the buy-back.')
  }
}
