'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { brokerageSchema } from '@/lib/validation'
import {
  createWatch, updateWatch, moveWatches, recordSale, deleteWatch, restoreWatch,
  setWatchStatus, voidSale,
} from '@/server/services/watch-service'
import {
  watchCreateSchema, watchUpdateSchema, watchMoveSchema, watchPriceSchema,
  watchAmendSchema, saleAmendSchema, saleCreateSchema, fieldErrors, type ContentField,
  type WatchAmendInput,
} from '@/lib/validation'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { BASE_CURRENCY, WATCH_STATUSES, WATCH_STATUS_LABELS, type CurrencyCode, type WatchStatus } from '@/lib/enums'
import { completeSourcing } from '@/server/services/sourcing-service'
import { pushWatchById } from '@/server/services/shopify-service'
import type { ActionState } from './auth'
import type { GroupPostBatch } from '@/lib/group-post'

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

/**
 * Tell the storefront, now rather than on a schedule.
 *
 * The point of the mirror is that marking a watch sold takes it off the
 * website — and "within the hour" is not that. So the push rides on the
 * mutation that caused it.
 *
 * Awaited rather than left dangling: a serverless function is killed once it
 * has answered, and a promise still in flight at that moment simply does not
 * happen. `pushWatchById` never throws and writes its own failures to the
 * watch, so awaiting it costs a few hundred milliseconds and cannot turn a
 * recorded sale into an error.
 */
async function mirror(watchId: string | null | undefined): Promise<void> {
  if (!watchId) return
  await pushWatchById(watchId)
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
    await mirror(id)
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
    await mirror(parsed.data.id)
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
    await mirror(parsed.data.id)
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
            : change.field === 'serial'
              ? { serial: change.serial }
              : change.field === 'stockNo'
                ? { stockNo: change.stockNo }
                : contentPatch(change.key, change.value)

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

/**
 * The selected watches, written out for a dealer group.
 *
 * A read rather than a mutation, but still an action: the capability is the
 * point. `watch:broadcast` is the owner's alone, and this hands back trade
 * prices for a whole selection at once — so it is asserted here rather than
 * trusted to the button being hidden.
 */
export async function groupPostsAction(
  watchIds: string[],
): Promise<{ ok: true; batch: GroupPostBatch } | { ok: false; message: string }> {
  const actor = await requireCapability('watch:broadcast')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  try {
    const { buildGroupPosts } = await import('@/server/services/group-post-service')
    return { ok: true, batch: await buildGroupPosts(watchIds) }
  } catch (error) {
    logger.error('group posts failed', { error: (error as Error).message })
    return { ok: false, message: 'Could not prepare those watches.' }
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
    const sale = await recordSale(parsed.data, actor)
    refreshInventory()
    revalidatePath('/sales')
    // The watch has left the building; it should leave the website too.
    await mirror(parsed.data.watchId)
    return {
      ok: true,
      message: 'Sale recorded and the watch moved to Sold.',
      id: sale.id,
      customerId: sale.customerId ?? undefined,
    }
  } catch (error) {
    return toState(error, 'Could not record the sale.')
  }
}

/**
 * Correct a sale that has already been booked.
 *
 * Behind `sale:update`, which Managers and Owners hold. Both already hold
 * `sale:delete` — the power to void the sale outright and book it again — so
 * withholding the lesser, non-destructive version of the same correction from
 * them would only push them towards the destructive one.
 */
/**
 * Record a fee earned selling somebody else's watch.
 *
 * Behind `sale:create`: it is the same act commercially — somebody sold
 * something and the business was paid — and the same people should be able
 * to book it in.
 */
export async function recordBrokerageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability('sale:create')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const parsed = brokerageSchema.safeParse({
    description: formData.get('description'),
    soldFor: formData.get('soldFor'),
    soldTo: formData.get('soldTo'),
    customerId: formData.get('customerId'),
    brokeredOn: formData.get('brokeredOn'),
    reference: formData.get('reference'),
    // Taken in major units on the form and stored in minor, as every other
    // money field on the system is.
    feeAmount: Math.round(Number(formData.get('feeAmount') ?? 0) * 100),
    feeCurrency: formData.get('feeCurrency') || undefined,
    paymentStatus: formData.get('paymentStatus') || undefined,
    soldById: formData.get('soldById'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) {
    /*
     * A rejection always carries a sentence, not only field errors.
     *
     * This form rejected on `customerId` and `reference` — two fields it
     * does not render — and showed nothing at all, because the panel only
     * printed `message`. A form that can refuse silently is broken whatever
     * the underlying rule was.
     */
    logger.warn('brokerage rejected', { errors: parsed.error.flatten().fieldErrors })
    return {
      ok: false,
      message: 'Check the highlighted fields and try again.',
      errors: fieldErrors(parsed.error),
    }
  }

  try {
    const { recordBrokerage } = await import('@/server/services/brokerage-service')
    const id = await recordBrokerage(parsed.data, actor)
    revalidatePath('/sales')
    revalidatePath('/reports/pnl')
    revalidatePath('/reports/commission')
    return { ok: true, message: 'Commission recorded.', id }
  } catch (error) {
    return toState(error, 'Could not record the commission.')
  }
}

export async function amendSaleAction(input: unknown): Promise<ActionState> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const parsed = saleAmendSchema.safeParse(input)
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }

  try {
    const { amendSale } = await import('@/server/services/watch-service')
    const watchId = await amendSale(parsed.data, actor)
    refreshInventory()
    revalidatePath('/sales')
    revalidatePath(`/inventory/${watchId}`)
    // No Shopify push: the watch was sold before and is sold now, so nothing
    // the storefront can see has changed.
    return { ok: true, message: 'Sale corrected.' }
  } catch (error) {
    return toState(error, 'Could not correct the sale.')
  }
}

export async function deleteWatchAction(id: string): Promise<ActionState> {
  const actor = await requireCapability('watch:delete')
  try {
    await deleteWatch(id, actor)
    refreshInventory()
    await mirror(id)
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
    await mirror(id)
    return { ok: true, message: `Marked ${WATCH_STATUS_LABELS[status as WatchStatus].toLowerCase()}.` }
  } catch (error) {
    return toState(error, 'Could not change the status.')
  }
}

/**
 * Put a watch on hold, or take a deposit, and open the deal that records it.
 *
 * Two capabilities, because it is two writes: the status is an inventory edit
 * and the deal is a CRM one, and somebody who may do only the first should
 * not reach this door at all — a hold with no record of who it is for is the
 * thing this exists to stop.
 */
export async function holdOrDepositAction(input: {
  watchId: string
  status: 'RESERVED' | 'SALE_AGREED'
  customerId: string
  valueGbp: number | null
  depositGbp: number | null
  expectedClose: string | null
  notes: string | null
}): Promise<ActionState> {
  await requireCapability('watch:update')
  const actor = await requireCapability('deal:create')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  if (!input.customerId) {
    return { ok: false, message: 'Choose who it is for — a hold with no name on it is a watch nobody can sell.' }
  }
  if (input.status === 'SALE_AGREED' && !input.depositGbp) {
    return { ok: false, message: 'Enter the deposit taken.' }
  }

  try {
    const { holdOrDeposit } = await import('@/server/services/crm-service')
    const { dealId, created } = await holdOrDeposit(input, actor)
    refreshInventory()
    revalidatePath('/deals')
    revalidatePath(`/deals/${dealId}`)
    // A hold is still listed, but it is no longer buyable.
    await mirror(input.watchId)
    return {
      ok: true,
      id: dealId,
      message: input.status === 'SALE_AGREED'
        ? `Deposit recorded and the deal ${created ? 'opened' : 'updated'}.`
        : `On hold, and the deal ${created ? 'opened' : 'updated'}.`,
    }
  } catch (error) {
    return toState(error, 'Could not record that.')
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
    // Back in stock here means back on the website.
    await mirror(watchId)
    revalidatePath('/sales')
    return { ok: true, message: 'Sale voided. The watch is back in stock.' }
  } catch (error) {
    return toState(error, 'Could not void the sale.')
  }
}

/**
 * One cell of a listing, turned into a patch the service will accept.
 *
 * The grid sends a string, because that is what a cell holds, and the type
 * it has to become is a fact about the field rather than about the cell. Put
 * here rather than in each column so that a column is a label and a width,
 * and adding one is not an invitation to invent a twelfth way of meaning
 * "empty".
 *
 * Empty always clears. A blank cell in a spreadsheet means "nothing here",
 * and anything else — refusing it, keeping the old value, writing a zero —
 * is a surprise in the one interaction this screen exists for.
 */
function contentPatch(key: ContentField, raw: string): Record<string, unknown> {
  const value = raw.trim()

  if (key === 'year' || key === 'caseSizeMm' || key === 'waterResistanceM') {
    if (!value) return { [key]: null }
    const number = Number(value)
    // An unreadable number is left to the service's own validation rather
    // than silently becoming zero, which would read as a measured value.
    return { [key]: Number.isFinite(number) ? Math.round(number) : value }
  }

  // The two closed lists. A cell that is cleared goes back to "not recorded",
  // which is a real answer and the one the enum keeps a value for.
  if (key === 'condition') return { condition: value || 'UNKNOWN' }
  if (key === 'boxPapers') return { boxPapers: value || 'UNKNOWN' }

  return { [key]: value || null }
}

/**
 * Mark the money as received.
 *
 * Its own action rather than a trip through the correction dialog: "they
 * have paid" is the single most common thing that happens to a sale after it
 * is booked, and routing it through a form with eleven fields is how a
 * ledger ends up with every invoice still reading "Awaiting payment" six
 * months later.
 */
export async function markSalePaidAction(saleId: string): Promise<ActionState> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  try {
    const { markSalePaid } = await import('@/server/services/watch-service')
    await markSalePaid(saleId, actor)
    revalidatePath('/sales')
    refreshInventory()
    return { ok: true, message: 'Marked as paid in full.' }
  } catch (error) {
    return toState(error, 'Could not record the payment.')
  }
}
