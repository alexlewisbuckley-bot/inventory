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
  /** With what makes each one worth sending, so the number can be believed. */
  update: Array<{ stockNo: number; title: string; why: string }>
  archive: Array<{ sku: string | null; title: string }>
  remove: Array<{ sku: string | null; title: string }>
}

/**
 * Why a watch is being pushed, in words rather than in a field name.
 *
 * The list used to be a wall of stock numbers with a count on top and no way
 * to tell whether the count meant anything — it said the same number before
 * and after every push, because it was counting pages rather than
 * differences. Saying what moved is what makes the new number checkable:
 * read one line, recognise the change you made this morning, press Apply.
 */
const WHY: Record<string, string> = {
  record: 'changed here',
  status: 'the shop disagrees about whether it is live',
  renumbered: 'renumbered',
  invisible: 'in no sales channel',
  unknown: 'never pushed',
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
          stockNo: u.watch.stockNo,
          title: `${u.watch.brandName} ${u.watch.model}`,
          why: u.reasons.map((reason) => WHY[reason]).join(', '),
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
 * How many watches one press of Apply pushes before reporting back.
 *
 * Each watch is two or three round trips to somebody else's API, and a hundred
 * and thirty-one of them is minutes — far longer than a request is allowed to
 * live. Run whole, it was killed by the platform part-way through and the
 * button span until the person gave up, having been told nothing.
 *
 * The real guard is the clock, not this number: runSync stops a batch after
 * BATCH_SECONDS whatever is left, so this is a ceiling rather than a target.
 * That makes a small number pure cost — every extra round trip rebuilds the
 * whole plan, which means paging the shop's entire product list and reading
 * its taxonomy again. At twenty, the book was seven of those; at sixty it is
 * two or three, and a fast run simply gets further before the deadline bites.
 *
 * The caller presses on until there is no cursor left.
 */
const BATCH = 60

export interface ApplyResult extends ActionState {
  /** Where the next press should carry on from, or null when it is finished. */
  nextCursor: number | null
  pushed: number
  total: number
  created: number
  updated: number
  archived: number
  removed: number
  failed: number
}

const nothingApplied: Omit<ApplyResult, 'ok' | 'message'> = {
  nextCursor: null, pushed: 0, total: 0,
  created: 0, updated: 0, archived: 0, removed: 0, failed: 0,
}

/**
 * Make the storefront match the book — a batch at a time.
 *
 * Owner-only and audited, because it is the one button in the application that
 * permanently destroys something outside it. The audit is written on the first
 * batch, which is where the deleting happens.
 */
export async function applySyncAction(after: number | null = null): Promise<ApplyResult> {
  try {
    const actor = await requireCapability('watch:delete')
    const { plan, outcome } = await runSync({ apply: true, after, limit: BATCH })
    if (!outcome) return { ok: false, message: 'Nothing was applied.', ...nothingApplied }

    if (after === null) {
      await recordAudit({
        entityType: 'Watch',
        entityId: 'storefront',
        action: 'UPDATE',
        actorId: actor.id,
        summary: `Storefront sync started — ${plan.create.length} to add, `
          + `${plan.update.length} to update, ${plan.archive.length} to archive, `
          + `${plan.remove.length} to delete`,
        changes: {
          removed: { from: plan.remove.map((r) => r.title).join(', ') || null, to: null },
        },
      })
    }

    revalidatePath('/settings/storefront')
    const failed = outcome.failed.length
    // Fields the shop has no entry for. Not a failure — the page is live and
    // correct — but the theme filters on them, so a watch missing one will not
    // appear when somebody browses by dial colour.
    const gaps = [...new Set(outcome.unmatched.map((u) => `${u.field} "${u.value}"`))]
    const addedNote = outcome.added.length
      ? ` Added ${outcome.added.length} missing ${outcome.added.length === 1 ? 'entry' : 'entries'} to the shop's own lists.`
      : ''
    const note = gaps.length
      ? `${addedNote} ${gaps.length} value${gaps.length === 1 ? '' : 's'} the shop has no entry for: ${gaps.slice(0, 6).join(', ')}${gaps.length > 6 ? '…' : ''}.`
      : addedNote

    const counts = {
      nextCursor: outcome.nextCursor,
      pushed: outcome.pushed,
      total: outcome.total,
      created: outcome.created,
      updated: outcome.updated,
      archived: outcome.archived,
      removed: outcome.removed,
      failed,
    }

    if (failed > 0) {
      return {
        ok: false,
        message: `${failed} of them failed. ${outcome.failed[0]?.what}: ${outcome.failed[0]?.error}`,
        ...counts,
      }
    }

    // Something the shop would not let this app do, as opposed to something
    // that went wrong with a watch. Said once and said plainly, because the
    // remedy is a permission on the app and nothing to do with the stock —
    // and worth flagging rather than burying, since a product the app cannot
    // publish is a product nobody browsing the site will ever see.
    const refused = outcome.denied.length
      ? ` The shop refused one thing, which needs a permission adding to the app: ${outcome.denied[0]}`
      : ''

    // Only the last batch gets to say "done"; the ones before it are reporting
    // progress, and a toast per batch saying "done" six times is a lie told
    // five times.
    if (outcome.nextCursor !== null) {
      return { ok: true, message: `${outcome.pushed} pushed.`, ...counts }
    }

    return {
      ok: outcome.denied.length === 0,
      message: `Done — ${outcome.created} added, ${outcome.updated} updated, `
        + `${outcome.archived} archived, ${outcome.removed} deleted.${note}${refused}`,
      ...counts,
    }
  } catch (error) {
    return { ...toState(error, 'Could not sync the storefront.'), ...nothingApplied }
  }
}

export async function storefrontHealthAction() {
  await requireCapability('watch:read')
  return syncHealth()
}
