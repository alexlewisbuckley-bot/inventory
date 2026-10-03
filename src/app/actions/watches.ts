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
  watchAmendSchema, saleCreateSchema, fieldErrors,
  type WatchAmendInput,
} from '@/lib/validation'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { BASE_CURRENCY, WATCH_STATUSES, WATCH_STATUS_LABELS, type CurrencyCode, type WatchStatus } from '@/lib/enums'
import { completeSourcing } from '@/server/services/sourcing-service'
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

    // Intake that came from a want settles the paperwork: the want is
    // fulfilled, its owner is told, and a task to offer the watch exists.
    // Guarded, because the watch now exists in stock — that is a fact, and a
    // hiccup in the follow-up must not unmake it or fail the form.
    const requestId = formData.get('requestId')?.toString()
    if (requestId) {
      try {
        await completeSourcing(id, requestId, actor)
        revalidatePath('/requests')
        revalidatePath('/tasks')
      } catch (error) {
        logger.warn('sourcing follow-up failed after intake', {
          watchId: id, requestId, error: (error as Error).message,
        })
      }
    }

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

/**
 * Correct one figure from the list, without opening the record.
 *
 * The same service call the edit form makes, so the version check, the audit
 * entry and the money conversion are the ones the record has always used —
 * an in-place edit is a different gesture, not a different write path. The
 * capability is the owner's alone; the cells that offer this are hidden
 * without it, and this is the door that actually holds.
 */
export async function amendWatchAction(input: WatchAmendInput): Promise<ActionState> {
  const actor = await requireCapability('watch:amend')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const parsed = watchAmendSchema.safeParse(input)
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }
  const change = parsed.data

  try {
    const { getWatchDetail } = await import('@/server/services/watch-service')
    const current = await getWatchDetail(change.id)

    const patch =
      change.field === 'purchase'
        ? { purchaseAmount: change.amount, purchaseCurrency: change.currency }
        : change.field === 'trade'
          ? { tradeAmount: change.amount, tradeCurrency: change.currency }
          : change.field === 'year'
            ? { year: change.year }
            : { serial: change.serial }

    await updateWatch({ id: change.id, version: current.watch.version, ...patch }, actor)
    refreshInventory()
    return { ok: true, message: 'Saved.' }
  } catch (error) {
    return toState(error, 'Could not save that change.')
  }
}

/**
 * Take a copy of a banked photograph for this watch.
 *
 * The library is kept against the reference, so this is only ever "use the
 * picture of this model we already have" — the service checks the brand and
 * reference match before it copies anything, which is what stops it becoming
 * a way to put one watch's photograph on another.
 */
export async function useLibraryImageAction(
  input: { watchId: string; referenceImageId: string },
): Promise<ActionState> {
  const actor = await requireCapability('watch:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  try {
    const { useLibraryImage } = await import('@/server/services/image-service')
    const image = await useLibraryImage(input, actor)
    refreshInventory()
    revalidatePath(`/inventory/${input.watchId}`)
    return { ok: true, message: 'Photograph added.', id: image.id }
  } catch (error) {
    return toState(error, 'Could not use that photograph.')
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
    const { created, updated, skipped, photographs } = await commitImport(rows, actor)
    refreshInventory()
    // Says what actually happened rather than one total. "28 watches imported"
    // when twenty-seven were left alone is the sentence that makes somebody
    // think they have just duplicated their inventory.
    const parts = [
      created > 0 ? `${created} booked in` : null,
      updated > 0 ? `${updated} updated` : null,
      skipped > 0 ? `${skipped} unchanged` : null,
      // Worth saying out loud: a watch arriving with a photograph nobody took
      // today looks like a mistake until you know where it came from.
      photographs > 0 ? `${photographs} dressed from the photograph library` : null,
    ].filter(Boolean)
    return { ok: true, message: parts.length > 0 ? `Import complete — ${parts.join(', ')}.` : 'Nothing to change.' }
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
