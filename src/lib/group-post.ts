/**
 * The shape of a group-post batch, apart from the work of building one.
 *
 * Split from the service deliberately. The queue that walks a batch is a
 * client component, and importing anything from the service pulled the
 * database client — and `node:async_hooks` with it — into the browser
 * bundle, which does not build. Types and labels live here; the query lives
 * on the server.
 */

export interface GroupPost {
  watchId: string
  stockNo: number
  /** The whole message, ready to send. */
  caption: string
  /** The trade shot, or the watch shot. */
  imageId: string
  /** For the progress line — "Rolex Daytona", not the whole caption. */
  label: string
}

/** Why a selected watch is not in the batch. Shown back, never silent. */
export type SkipReason = 'sold' | 'no-photo' | 'no-price' | 'not-here'

export interface GroupPostBatch {
  posts: GroupPost[]
  skipped: Array<{ stockNo: number; label: string; reason: SkipReason }>
}

export const SKIP_LABELS: Record<SkipReason, string> = {
  sold: 'already sold',
  'no-photo': 'no photograph',
  'no-price': 'no trade price',
  /*
   * Worded as where it is rather than why it was dropped, because that is
   * the thing the sender has to act on: the watch is fine, it is simply
   * somewhere a dealer cannot be shown it today.
   */
  'not-here': 'in transit',
}

/** "2 left out: 1 already sold, 1 no trade price" — never a silent omission. */
export function describeSkips(batch: GroupPostBatch): string {
  if (batch.skipped.length === 0) return ''
  const counts = new Map<string, number>()
  for (const skip of batch.skipped) {
    const reason = SKIP_LABELS[skip.reason]
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  const parts = [...counts].map(([reason, count]) => `${count} ${reason}`)
  return `${batch.skipped.length} left out: ${parts.join(', ')}`
}
