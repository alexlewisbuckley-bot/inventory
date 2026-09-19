'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import {
  abandonStockCheck, completeStockCheck, recordLine, scanForCheck, startStockCheck,
  type ScanResult, type StockCheckOutcome,
} from '@/server/services/stock-check-service'
import { isAppError } from '@/lib/errors'
import type { StockCheckLineStatus } from '@/lib/enums'
import { logger } from '@/lib/logger'

/**
 * Taking a stock check.
 *
 * `watch:move` throughout rather than a capability of its own: counting stock
 * and moving it between locations are the same job done by the same people,
 * and a role trusted to say where a watch is should be trusted to say whether
 * it is there.
 */

export interface StockCheckActionState {
  ok: boolean
  message?: string
  id?: string
  outcome?: StockCheckOutcome
}

export async function startStockCheckAction(
  locationId: string | null,
  notes: string | null,
): Promise<StockCheckActionState> {
  const actor = await requireCapability('watch:move')
  try {
    const id = await startStockCheck({ locationId: locationId || null, notes }, actor)
    revalidatePath('/stock-checks')
    return { ok: true, id, message: 'Stock check opened.' }
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message }
    logger.error('start stock check failed', { error: (error as Error).message })
    return { ok: false, message: 'That stock check could not be started.' }
  }
}

/** Count one watch by what is written on it. */
export async function scanForCheckAction(checkId: string, term: string): Promise<ScanResult> {
  const actor = await requireCapability('watch:move')
  try {
    const result = await scanForCheck(checkId, term, actor)
    if (result.ok) revalidatePath(`/stock-checks/${checkId}`)
    return result
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message }
    logger.error('scan failed', { checkId, error: (error as Error).message })
    return { ok: false, message: 'That could not be counted.' }
  }
}

/** Record an outcome against one line from the list. */
export async function recordLineAction(
  checkId: string,
  watchId: string,
  status: StockCheckLineStatus,
  foundLocationId: string | null,
  notes: string | null,
  move: boolean,
): Promise<StockCheckActionState> {
  const actor = await requireCapability('watch:move')
  try {
    const line = await recordLine(
      checkId, watchId, { status, foundLocationId, notes, move }, actor,
    )
    revalidatePath(`/stock-checks/${checkId}`)
    if (line.movedTo) revalidatePath('/inventory')

    return {
      ok: true,
      message: line.movedTo
        ? `Stock ${line.stockNo} found at ${line.movedTo}, and moved there.`
        : `Stock ${line.stockNo} recorded as ${line.status.toLowerCase().replace('_', ' ')}.`,
    }
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message }
    logger.error('record line failed', { checkId, watchId, error: (error as Error).message })
    return { ok: false, message: 'That could not be recorded.' }
  }
}

export async function completeStockCheckAction(checkId: string): Promise<StockCheckActionState> {
  const actor = await requireCapability('watch:move')
  try {
    const outcome = await completeStockCheck(checkId, actor)
    revalidatePath('/stock-checks')
    revalidatePath(`/stock-checks/${checkId}`)

    return {
      ok: true,
      outcome,
      message: outcome.missing === 0
        ? `All ${outcome.expected} accounted for.`
        : `${outcome.missing} of ${outcome.expected} unaccounted for.`,
    }
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message }
    logger.error('complete stock check failed', { checkId, error: (error as Error).message })
    return { ok: false, message: 'That stock check could not be completed.' }
  }
}

export async function abandonStockCheckAction(
  checkId: string,
  reason: string | null,
): Promise<StockCheckActionState> {
  const actor = await requireCapability('watch:move')
  try {
    await abandonStockCheck(checkId, reason, actor)
    revalidatePath('/stock-checks')
    revalidatePath(`/stock-checks/${checkId}`)
    return { ok: true, message: 'Stock check abandoned. Nothing was recorded against the stock.' }
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message }
    logger.error('abandon stock check failed', { checkId, error: (error as Error).message })
    return { ok: false, message: 'That stock check could not be abandoned.' }
  }
}
