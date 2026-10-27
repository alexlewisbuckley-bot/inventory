'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import {
  stageImport, applyImport, linkSale, unlinkSale, setInvoiceRate, setInvoiceBucket,
  approveAlias,
} from '@/server/services/xero-service'
import { XERO_FIELDS, type XeroField } from '@/lib/xero-diff'
import { logger } from '@/lib/logger'

/**
 * Reconciling the ledger against Xero, from the screen.
 *
 * Reading a file and writing the ledger are deliberately two different
 * actions with two different capabilities behind them. Alex: "Nothing
 * writes until approved" — and the surest way to honour that is for the
 * action that reads a file to have no path to a sale at all.
 */

export interface StageResult {
  ok: boolean
  importId?: string
  invoiceCount?: number
  matchedCount?: number
  skippedRows?: number
  /** Whether these invoices were read out of pictures rather than a file. */
  fromScreenshots?: boolean
  message?: string
}

export async function stageXeroImportAction(formData: FormData): Promise<StageResult> {
  // Importing a file, which is what this is, even though it writes no sale.
  const actor = await requireCapability('data:import')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  // Several, because a screen of invoices is often two or three pictures.
  const files = formData.getAll('file').filter(
    (entry): entry is File => entry instanceof File && entry.size > 0,
  )
  if (files.length === 0) {
    return { ok: false, message: 'Choose a Xero export or a screenshot to read.' }
  }
  try {
    const result = await stageImport(
      await Promise.all(files.map(async (file) => ({
        name: file.name,
        mimeType: file.type || undefined,
        buffer: await file.arrayBuffer(),
      }))),
      actor,
    )
    revalidatePath('/sales/reconcile')
    return { ok: true, ...result }
  } catch (error) {
    logger.warn('xero import failed', { error: String(error), actorId: actor.id })
    return { ok: false, message: error instanceof Error ? error.message : 'That file could not be read.' }
  }
}

export interface ApplyResultState {
  ok: boolean
  salesChanged?: number
  fieldsChanged?: number
  message?: string
}

/**
 * Write what was ticked.
 *
 * The approvals arrive as one form field per approved change, named
 * `approve:<saleId>:<field>`, so a field nobody ticked simply is not in the
 * payload. Rejecting is the absence of an approval rather than a flag,
 * which means a truncated or tampered form can only ever write less than
 * was shown, never more.
 */
export async function applyXeroImportAction(formData: FormData): Promise<ApplyResultState> {
  // Correcting money on the ledger, so the capability for correcting a sale.
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  const importId = formData.get('importId')?.toString()
  if (!importId) return { ok: false, message: 'Which import?' }

  const approvals: Record<string, XeroField[]> = {}
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('approve:') || value !== 'on') continue
    const [, saleId, field] = key.split(':')
    if (!saleId || !field) continue
    // Only a field Xero is allowed to own can be approved, whatever the
    // form says.
    if (!(XERO_FIELDS as readonly string[]).includes(field)) continue
    approvals[saleId] = [...(approvals[saleId] ?? []), field as XeroField]
  }

  if (Object.keys(approvals).length === 0) {
    return { ok: false, message: 'Nothing was ticked, so nothing was changed.' }
  }

  try {
    const result = await applyImport(importId, approvals, actor)
    revalidatePath('/sales/reconcile')
    revalidatePath('/sales')
    return { ok: true, ...result }
  } catch (error) {
    logger.warn('xero apply failed', { error: String(error), actorId: actor.id })
    return { ok: false, message: error instanceof Error ? error.message : 'Those changes could not be applied.' }
  }
}

export async function linkSaleAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  const importId = formData.get('importId')?.toString()
  const invoiceId = formData.get('invoiceId')?.toString()
  const saleId = formData.get('saleId')?.toString()
  if (!importId || !invoiceId || !saleId) return { ok: false, message: 'Pick a sale to link.' }
  try {
    await linkSale(importId, invoiceId, saleId)
    revalidatePath('/sales/reconcile')
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'That could not be linked.' }
  }
}

export async function unlinkSaleAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  const importId = formData.get('importId')?.toString()
  const saleId = formData.get('saleId')?.toString()
  if (!importId || !saleId) return { ok: false, message: 'Pick a sale to unlink.' }
  await unlinkSale(importId, saleId)
  revalidatePath('/sales/reconcile')
  return { ok: true }
}

export async function setRateAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  const importId = formData.get('importId')?.toString()
  const invoiceId = formData.get('invoiceId')?.toString()
  const rate = Number(formData.get('rate'))
  if (!importId || !invoiceId) return { ok: false, message: 'Which invoice?' }
  try {
    await setInvoiceRate(importId, invoiceId, rate)
    revalidatePath('/sales/reconcile')
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'That rate could not be saved.' }
  }
}

export async function setBucketAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  const importId = formData.get('importId')?.toString()
  const invoiceId = formData.get('invoiceId')?.toString()
  const bucket = formData.get('bucket')?.toString()
  if (!importId || !invoiceId) return { ok: false, message: 'Which invoice?' }
  if (bucket !== 'SALE' && bucket !== 'BUYBACK' && bucket !== 'NOT_A_SALE') {
    return { ok: false, message: 'Pick what this invoice is.' }
  }
  await setInvoiceBucket(importId, invoiceId, bucket)
  revalidatePath('/sales/reconcile')
  return { ok: true }
}

export async function approveAliasAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  const systemName = formData.get('systemName')?.toString()
  const xeroName = formData.get('xeroName')?.toString()
  if (!systemName || !xeroName) return { ok: false, message: 'Both names are needed.' }
  await approveAlias(systemName, xeroName, actor)
  revalidatePath('/sales/reconcile')
  return { ok: true }
}
