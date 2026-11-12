import { and, eq, inArray, ne } from 'drizzle-orm'
import { db } from '../db/client'
import { partnerOrders } from '../db/schema'
import { recordAudit } from './audit'
import type { WatchStatus } from '@/lib/enums'

/**
 * Keeping a partner's hold in step with the watch it is on.
 *
 * Alex: "I removed this from hold and synced but still shows as on hold on
 * Partner portal."
 *
 * He was right and the portal was wrong. A partner order carried its own
 * status, and the portal read that alone — so taking the watch off hold by any
 * route other than the Release button on the held-stock list left the order
 * saying PLACED for ever. The watch was back on sale to everybody while the
 * company that reserved it was still being told it was theirs.
 *
 * Two sources of truth for one fact, which is the bug underneath the symptom.
 * This closes the order wherever the watch moves: sold the ordinary way,
 * marked back into stock on its own screen, written off, anything. Called from
 * every status write rather than from the one the screen uses, because the
 * route somebody takes is exactly what nobody can predict.
 */
export async function closeHoldsForWatch(
  watchId: string,
  newStatus: WatchStatus,
  actorId: string | null,
  stockNo: number,
): Promise<void> {
  // Still reserved means the hold still stands — a watch going from RESERVED
  // to RESERVED is not a release, and neither is one arriving there.
  if (newStatus === 'RESERVED') return

  const live = await db
    .select({ id: partnerOrders.id })
    .from(partnerOrders)
    .where(and(eq(partnerOrders.watchId, watchId), eq(partnerOrders.status, 'PLACED')))

  if (live.length === 0) return

  /*
   * Sold closes the order as completed; anything else releases it.
   *
   * A partner order that ends in a sale is the happy ending, and filing it as
   * "released" would read on the campaign screen as somebody having changed
   * their mind — which is a different conversation from the one that actually
   * happened.
   */
  const completed = newStatus === 'SOLD'
  await db.update(partnerOrders)
    .set({
      status: completed ? 'COMPLETED' : 'RELEASED',
      ...(completed ? { completedAt: new Date() } : { releasedAt: new Date() }),
      ...(completed ? {} : { releaseReason: 'The watch moved on in stock.' }),
      updatedAt: new Date(),
    })
    .where(inArray(partnerOrders.id, live.map((row) => row.id)))

  for (const row of live) {
    await recordAudit({
      entityType: 'PartnerOrder', entityId: row.id, action: 'UPDATE', actorId,
      summary: completed
        ? `Stock ${stockNo} sold, so the partner order closed with it`
        : `Stock ${stockNo} left hold, so the partner order was released with it`,
    })
  }
}

/** Watch statuses that leave a partner's hold standing. */
export const HOLDING_STATUSES: WatchStatus[] = ['RESERVED']

/** Live holds among a set of watches, for a screen that must not claim a stale one. */
export async function liveHoldWatchIds(watchIds: string[]): Promise<Set<string>> {
  if (watchIds.length === 0) return new Set()
  const rows = await db
    .select({ watchId: partnerOrders.watchId })
    .from(partnerOrders)
    .where(and(
      inArray(partnerOrders.watchId, watchIds),
      eq(partnerOrders.status, 'PLACED'),
      ne(partnerOrders.status, 'RELEASED'),
    ))
  return new Set(rows.map((row) => row.watchId))
}
