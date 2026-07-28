'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import {
  createWatch, updateWatch, moveWatches, recordSale, deleteWatch, restoreWatch,
} from '@/server/services/watch-service'
import {
  watchCreateSchema, watchUpdateSchema, watchMoveSchema, watchPriceSchema,
  saleCreateSchema, fieldErrors,
} from '@/lib/validation'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { ActionState } from './auth'

/** Convert a thrown error into the serialisable shape forms expect. */
function toState(error: unknown, fallback: string): ActionState {
  if (isAppError(error)) {
    return { ok: false, message: error.message, errors: error.details as Record<string, string> | undefined }
  }
  logger.error(fallback, { error: (error as Error).message })
  return { ok: false, message: fallback }
}

function refreshInventory(): void {
  revalidatePath('/inventory')
  revalidatePath('/')
}

export async function createWatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('watch:create')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const parsed = watchCreateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    const id = await createWatch(parsed.data, actor)
    refreshInventory()
    return { ok: true, message: 'Watch added to stock.', errors: { id } }
  } catch (error) {
    return toState(error, 'Could not add the watch.')
  }
}

export async function updateWatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('watch:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const parsed = watchUpdateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    await updateWatch(parsed.data, actor)
    refreshInventory()
    revalidatePath(`/inventory/${parsed.data.id}`)
    return { ok: true, message: 'Changes saved.' }
  } catch (error) {
    return toState(error, 'Could not save your changes.')
  }
}

/** Inline price edit — used by the unpriced worklist for fast data entry. */
export async function setPriceAction(id: string, estSaleUsd: number): Promise<ActionState> {
  const actor = await requireCapability('watch:price')
  const parsed = watchPriceSchema.safeParse({ id, estSaleUsd })
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    const { getWatchDetail } = await import('@/server/services/watch-service')
    const current = await getWatchDetail(parsed.data.id)
    await updateWatch(
      { id: parsed.data.id, version: current.watch.version, estSaleUsd: parsed.data.estSaleUsd },
      actor,
    )
    refreshInventory()
    return { ok: true, message: 'Price updated.' }
  } catch (error) {
    return toState(error, 'Could not update the price.')
  }
}

export async function moveWatchesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('watch:move')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const parsed = watchMoveSchema.safeParse({
    watchIds: formData.getAll('watchIds').map(String),
    toLocationId: formData.get('toLocationId'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    const moved = await moveWatches(parsed.data.watchIds, parsed.data.toLocationId, parsed.data.reason, actor)
    refreshInventory()
    return {
      ok: true,
      message: moved === 0
        ? 'Those watches are already in that location.'
        : `${moved} ${moved === 1 ? 'watch' : 'watches'} moved.`,
    }
  } catch (error) {
    return toState(error, 'Could not move the stock.')
  }
}

export async function recordSaleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('sale:create')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const parsed = saleCreateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    await recordSale(parsed.data, actor)
    refreshInventory()
    revalidatePath('/sales')
    return { ok: true, message: 'Sale recorded and the watch moved to Sold.' }
  } catch (error) {
    return toState(error, 'Could not record the sale.')
  }
}

export async function deleteWatchAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('watch:delete')
  try {
    await deleteWatch(id, actor)
    refreshInventory()
    return { ok: true, message: 'Watch deleted. It can be restored from the deleted filter.' }
  } catch (error) {
    return toState(error, 'Could not delete the watch.')
  }
}

export async function restoreWatchAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('watch:restore')
  try {
    await restoreWatch(id, actor)
    refreshInventory()
    return { ok: true, message: 'Watch restored.' }
  } catch (error) {
    return toState(error, 'Could not restore the watch.')
  }
}
