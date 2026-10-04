'use server'
import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import { plan as computePlan, runSync, syncHealth } from '@/server/services/shopify-service'
import { recordAudit } from '@/server/services/audit'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { ActionState } from './auth'

export interface PlanSummary {
  create: Array<{ stockNo: number; title: string }>
  update: Array<{ stockNo: number; title: string }>
  archive: Array<{ sku: string | null; title: string }>
  remove: Array<{ sku: string | null; title: string }>
}

function toState(error: unknown, fallback: string): ActionState {
  if (isAppError(error)) return { ok: false, message: error.message }
  logger.error(fallback, { error: (error as Error).message })
  return { ok: false, message: (error as Error).message?.slice(0, 300) || fallback }
}

/**
 * What the sync would do, without doing any of it.
 *
 * Read before write, always, because the destructive half of this deletes
 * product pages that are live on a public storefront. Somebody should see the
 * list of titles about to disappear and recognise them before it happens.
 */
export async function previewSyncAction(): Promise<ActionState & { plan?: PlanSummary }> {
  try {
    await requireCapability('watch:update')
    const result = await computePlan()
    return {
      ok: true,
      plan: {
        create: result.create.map((w) => ({ stockNo: w.stockNo, title: `${w.brandName} ${w.model}` })),
        update: result.update.map((u) => ({
          stockNo: u.watch.stockNo, title: `${u.watch.brandName} ${u.watch.model}`,
        })),
        archive: result.archive.map((a) => ({ sku: a.sku, title: a.title })),
        remove: result.remove.map((r) => ({ sku: r.sku, title: r.title })),
      },
    }
  } catch (error) {
    return toState(error, 'Could not read the storefront.')
  }
}

/**
 * Make the storefront match the book.
 *
 * Owner-only and audited, because it is the one button in the application that
 * permanently destroys something outside it.
 */
export async function applySyncAction(): Promise<ActionState> {
  try {
    const actor = await requireCapability('watch:delete')
    const { plan, outcome } = await runSync({ apply: true })
    if (!outcome) return { ok: false, message: 'Nothing was applied.' }

    await recordAudit({
      entityType: 'Watch',
      entityId: 'storefront',
      action: 'UPDATE',
      actorId: actor.id,
      summary: `Storefront synced — ${outcome.created} created, ${outcome.updated} updated, `
        + `${outcome.archived} archived, ${outcome.removed} deleted`,
      changes: {
        removed: { from: plan.remove.map((r) => r.title).join(', ') || null, to: null },
      },
    })

    revalidatePath('/settings/storefront')
    const failed = outcome.failed.length
    // Fields the shop has no entry for. Not a failure — the page is live and
    // correct — but the theme filters on them, so a watch missing one will not
    // appear when somebody browses by dial colour.
    const gaps = [...new Set(outcome.unmatched.map((u) => `${u.field} "${u.value}"`))]
    const note = gaps.length
      ? ` ${outcome.unmatched.length} field${outcome.unmatched.length === 1 ? '' : 's'} had no match in the shop: ${gaps.slice(0, 6).join(', ')}${gaps.length > 6 ? '…' : ''}. Add them by hand.`
      : ''

    return {
      ok: failed === 0,
      message: failed === 0
        ? `Done — ${outcome.created} added, ${outcome.updated} updated, ${outcome.archived} archived, ${outcome.removed} deleted.${note}`
        : `${failed} of them failed. ${outcome.failed[0]?.what}: ${outcome.failed[0]?.error}`,
    }
  } catch (error) {
    return toState(error, 'Could not sync the storefront.')
  }
}

export async function storefrontHealthAction() {
  await requireCapability('watch:read')
  return syncHealth()
}
