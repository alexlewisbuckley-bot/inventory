'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import {
  createWatch, updateWatch, moveWatches, recordSale, deleteWatch, restoreWatch,
  setWatchStatus, voidSale,
} from '@/server/services/watch-service'
import {
  watchCreateSchema, watchUpdateSchema, watchMoveSchema, watchPriceSchema,
  saleCreateSchema, fieldErrors,
} from '@/lib/validation'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { BASE_CURRENCY, WATCH_STATUSES, WATCH_STATUS_LABELS, type CurrencyCode, type WatchStatus } from '@/lib/enums'
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

/**
 * Inline price edit — used by the unpriced worklist for fast data entry.
 *
 * Takes the amount in the currency the user typed it in. The caller used to
 * convert to USD first, which meant a price entered in dirhams was rounded
 * twice before it was stored.
 */
export async function setPriceAction(
  id: string,
  estSaleAmount: number,
  estSaleCurrency: CurrencyCode = BASE_CURRENCY,
): Promise<ActionState> {
  const actor = await requireCapability('watch:price')
  const parsed = watchPriceSchema.safeParse({ id, estSaleAmount, estSaleCurrency })
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    const { getWatchDetail } = await import('@/server/services/watch-service')
    const current = await getWatchDetail(parsed.data.id)
    await updateWatch(
      {
        id: parsed.data.id,
        version: current.watch.version,
        estSaleAmount: parsed.data.estSaleAmount,
        estSaleCurrency: parsed.data.estSaleCurrency,
      },
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

// --- Spreadsheet import ----------------------------------------------------

export interface ImportPreviewState extends ActionState {
  preview?: import('@/server/services/import-service').ImportPreview
}

/**
 * Validate an uploaded or pasted file without writing anything.
 *
 * Kept separate from the commit so the user always sees exactly what will be
 * created, and which rows will be rejected and why, before any change.
 */
export async function previewImportAction(
  _prev: ImportPreviewState,
  formData: FormData,
): Promise<ImportPreviewState> {
  const actor = await requireCapability('data:import')
  rateLimit({ key: `import:${actor.id}`, ...LIMITS.import })

  const file = formData.get('file')
  const pasted = formData.get('csv')?.toString() ?? ''
  const hasFile = file instanceof File && file.size > 0

  if (!hasFile && !pasted.trim()) {
    return { ok: false, message: 'Choose a file, or paste your rows below.' }
  }
  const MAX_BYTES = 5_000_000
  if (hasFile && file.size > MAX_BYTES) {
    return { ok: false, message: 'That file is over 5 MB. Split it into smaller batches.' }
  }
  if (!hasFile && pasted.length > MAX_BYTES) {
    return { ok: false, message: 'That is more text than the importer will take in one go. Split it into batches.' }
  }

  try {
    const { parseImport } = await import('@/server/services/import-service')
    // A spreadsheet has to reach the parser as bytes; decoding it as text first
    // is how an .xlsx arrives as a page of binary and reports 400 errors.
    const preview = hasFile
      ? await parseImport({ name: file.name, buffer: await file.arrayBuffer() })
      : await parseImport(pasted)
    return { ok: preview.errorCount === 0, preview }
  } catch (error) {
    return toState(error, 'Could not read that file. If it is a spreadsheet, make sure it is .xlsx rather than the older .xls.')
  }
}

export async function commitImportAction(
  rows: import('@/server/services/import-service').ImportRow[],
): Promise<ActionState> {
  const actor = await requireCapability('data:import')
  rateLimit({ key: `import:${actor.id}`, ...LIMITS.import })

  try {
    const { commitImport } = await import('@/server/services/import-service')
    const count = await commitImport(rows, actor)
    refreshInventory()
    return { ok: true, message: `${count} ${count === 1 ? 'watch' : 'watches'} imported.` }
  } catch (error) {
    return toState(error, 'Could not complete the import.')
  }
}

/**
 * Change a watch's status from the table or the drawer.
 *
 * Kept separate from updateWatchAction because it carries no optimistic
 * concurrency token: this is a one-click control on a list, and demanding the
 * caller hold a version it never read would make the common case fail.
 */
export async function setStatusAction(id: string, status: string): Promise<ActionState> {
  const actor = await requireCapability('watch:update')
  if (!WATCH_STATUSES.includes(status as WatchStatus)) {
    return { ok: false, message: 'That is not a status this system recognises.' }
  }

  try {
    await setWatchStatus(id, status as WatchStatus, actor)
    refreshInventory()
    return { ok: true, message: `Marked ${WATCH_STATUS_LABELS[status as WatchStatus].toLowerCase()}.` }
  } catch (error) {
    return toState(error, 'Could not change the status.')
  }
}

/**
 * Void a sale and return the watch to stock.
 *
 * Gated on sale:delete rather than watch:update — reversing an invoice is a
 * financial correction, not an inventory edit.
 */
export async function voidSaleAction(watchId: string, reason: string): Promise<ActionState> {
  const actor = await requireCapability('sale:delete')

  try {
    await voidSale(watchId, reason.trim() || null, actor)
    refreshInventory()
    revalidatePath('/sales')
    return { ok: true, message: 'Sale voided. The watch is back in stock.' }
  } catch (error) {
    return toState(error, 'Could not void the sale.')
  }
}
