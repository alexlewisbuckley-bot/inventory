'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import { describeDbError, isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { OVERHEAD_CADENCES, OVERHEAD_CATEGORIES, type OverheadCadence, type OverheadCategory } from '@/lib/enums'
import type { ActionState } from './auth'

function toState(error: unknown, fallback: string): ActionState {
  if (isAppError(error)) {
    return { ok: false, message: error.message, errors: error.details as Record<string, string> | undefined }
  }
  const described = describeDbError(error)
  if (described) return { ok: false, message: described }
  logger.error('overhead action failed', { error: (error as Error).message })
  return { ok: false, message: fallback }
}

/**
 * Behind `overhead:manage`, which only an owner holds.
 *
 * Reading the P&L is `report:read` like any other figure, but the rent and
 * the payroll are what a net profit is built on: everybody who may see the
 * statement should not thereby be able to rewrite its cost base.
 */
export async function saveOverheadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('overhead:manage')
  const id = formData.get('id')?.toString() || null

  try {
    const { saveOverhead } = await import('@/server/services/overhead-service')
    // Typed in dirhams, held in fils. Commas and a currency mark are what
    // somebody copying a figure off an invoice actually pastes.
    const typed = (formData.get('amount')?.toString() ?? '').replace(/[^0-9.]/g, '')
    const amount = Math.round(Number(typed || '0') * 100)
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, errors: { amount: 'Enter an amount above zero.' } }
    }

    const category = formData.get('category')?.toString() as OverheadCategory
    const cadence = formData.get('cadence')?.toString() as OverheadCadence
    if (!OVERHEAD_CATEGORIES.includes(category)) {
      return { ok: false, errors: { category: 'Choose a category.' } }
    }
    if (!OVERHEAD_CADENCES.includes(cadence)) {
      return { ok: false, errors: { cadence: 'Choose how often this falls due.' } }
    }

    await saveOverhead(id, {
      name: formData.get('name')?.toString() ?? '',
      category,
      amount,
      cadence,
      startsOn: formData.get('startsOn')?.toString() ?? '',
      endsOn: formData.get('endsOn')?.toString() || null,
      notes: formData.get('notes')?.toString() || null,
      isActive: formData.get('isActive') === 'on' || formData.get('isActive') === 'true',
    }, actor)

    revalidatePath('/reports/costs')
    revalidatePath('/reports/pnl')
    return { ok: true, message: id ? 'Saved.' : 'Added to running costs.' }
  } catch (error) {
    return toState(error, 'Could not save that cost.')
  }
}

export async function deleteOverheadAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('overhead:manage')
  try {
    const { deleteOverhead } = await import('@/server/services/overhead-service')
    await deleteOverhead(id, actor)
    revalidatePath('/reports/costs')
    revalidatePath('/reports/pnl')
    return { ok: true, message: 'Removed.' }
  } catch (error) {
    return toState(error, 'Could not remove that cost.')
  }
}
