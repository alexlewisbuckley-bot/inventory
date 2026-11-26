import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { onHandStock } from '@/server/db/predicates'

const read = (path: string) => readFileSync(path, 'utf8')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : []
  })
}

/**
 * Stock standing somewhere we cannot put our hands on.
 *
 * Alex: "Please ensure the hidden / inactive watches do not show up on search
 * for staff, they are seeing various watches that are in inactive locations."
 *
 * The Locations screen calls the switch Active; the column is `is_on_hand`,
 * and it is off for a courier's bag and for another country. Stock there is
 * still ours and still counted in capital and the reports, and it is
 * deliberately off the stock list — trackable only from the location itself.
 *
 * The rule was written out by hand in every query that needed it, so two
 * forgot: the palette returned watches the stock list hides, and Today
 * counted 294 held beside a sidebar reading 198. These guards are about
 * keeping it in one place, because the next query will forget it too.
 */
describe('stock we cannot put our hands on', () => {
  it('is one predicate, not a string copied into every query', () => {
    // Read off the chunks drizzle holds rather than String(), which gives
    // back "[object Object]" and would have asserted nothing at all.
    const text = (clause: ReturnType<typeof onHandStock>) =>
      (clause as unknown as { queryChunks: Array<{ value?: string[] }> })
        .queryChunks.map((chunk) => chunk.value?.join('') ?? '').join('')

    expect(text(onHandStock())).toContain('is_on_hand')
    expect(text(onHandStock())).toContain('IN (SELECT l.id FROM locations l')
    // And it can be aimed at an aliased column, which is what let the
    // palette's own query use it without rewriting its FROM.
    expect(text(onHandStock('w.location_id'))).toContain('w.location_id IN')
  })

  it('is not written out by hand anywhere else', () => {
    /*
     * The guard that matters. `liveSale` has one of these and it is why a
     * voided sale has never since been counted as revenue; this rule had
     * none, and two queries drifted.
     */
    const offenders = walk('src')
      .filter((path) => !path.endsWith(join('db', 'predicates.ts')))
      .filter((path) => read(path).includes(
        'location_id IN (SELECT l.id FROM locations l WHERE l.is_on_hand)',
      ))
    expect(offenders).toEqual([])
  })

  it('keeps the palette from offering what the stock list hides', () => {
    /*
     * The reported fault, in the file it was in. Searching a reference
     * returned five watches in an inactive location while the list beside
     * the search box would not show one of them.
     */
    const search = read('src/server/repositories/search-repository.ts')
    const watchHits = search.slice(
      search.indexOf('FROM watches w'),
      search.indexOf("ORDER BY exact DESC"),
    )
    expect(watchHits).toMatch(/onHandStock\('w\.location_id'\)/)
  })

  it('counts the same stock on Today as the stock list shows', () => {
    // 294 held beside a sidebar reading 198 is one figure nobody trusts.
    const insights = read('src/server/services/insights-service.ts')
    const snapshot = insights.slice(
      insights.indexOf('export async function stockSnapshot'),
      insights.indexOf('export async function', insights.indexOf('export async function stockSnapshot') + 10),
    )
    // All three figures on that card, not only the headline one.
    expect(snapshot.match(/onHandStock\(\)/g) ?? []).toHaveLength(3)
  })

  it('still lets a location show its own stock', () => {
    /*
     * The whole point of the rule is that this stock is trackable from the
     * location itself, so the scope that turns it off has to survive. A fix
     * that hid it everywhere would have hidden it from the one screen it is
     * meant to be on.
     */
    const repo = read('src/server/repositories/watch-repository.ts')
    expect(repo).toMatch(/if \(!scope\.heldAway\) \{/)
    expect(repo).toMatch(/heldAway\?: boolean/)
  })
})
