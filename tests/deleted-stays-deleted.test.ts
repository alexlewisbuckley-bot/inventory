import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const service = readFileSync('src/server/services/shopify-service.ts', 'utf8')
const actions = readFileSync('src/app/actions/watches.ts', 'utf8')

/**
 * A watch deleted in the book, still for sale on the website.
 *
 * Deleting a watch calls straight into the push to take its page down.
 * The push looked the watch up with `isNull(deletedAt)` in the where
 * clause and returned when it found nothing — so the one call that
 * existed to take the page down did nothing at all, precisely because
 * the watch had been deleted.
 *
 * The page then stayed live, for sale, until somebody happened to run a
 * full sync from the storefront screen, where it would finally turn up
 * as a page answering to no watch. Found in production: a deleted record
 * on sale at 250 dirhams with no photograph.
 *
 * This is the worst shape a sync bug can take, because every screen in
 * the system agrees the watch is gone.
 */
describe('a watch deleted here is taken off the website', () => {
  const push = service.slice(
    service.indexOf('export async function pushWatchById'),
    service.indexOf('export async function syncHealth'),
  )

  it('no longer filters the deleted watch out of its own lookup', () => {
    // The line that caused it: a deleted watch could not be found, so
    // nothing was done about it.
    expect(push).not.toMatch(/eq\(watches\.id, watchId\), isNull\(watches\.deletedAt\)/)
  })

  it('reads whether it was deleted, and what page it has', () => {
    expect(push).toMatch(/deletedAt: watches\.deletedAt/)
    expect(push).toMatch(/shopifyProductId: watches\.shopifyProductId/)
  })

  it('archives the page instead of returning', () => {
    expect(push).toMatch(/if \(row\.deletedAt\) \{[\s\S]{0,160}archiveProduct\(row\.shopifyProductId\)/)
  })

  it('does the same for a watch that is no longer syncable', () => {
    // Whatever took it out of the set — a location that stopped
    // publishing, a status that is not listed — is a reason to take the
    // page down, not to leave it exactly as it was.
    expect(push).toMatch(/if \(!watch\) \{[\s\S]{0,200}archiveProduct\(row\.shopifyProductId\)/)
  })

  it('is still reached from the delete action', () => {
    const fn = actions.slice(actions.indexOf('export async function deleteWatchAction'))
    expect(fn.slice(0, 600)).toMatch(/await mirror\(id\)/)
  })

  it('archives rather than deletes, as everywhere else', () => {
    expect(push).not.toMatch(/productDelete/)
  })
})
