import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HELD_STATUSES, WATCH_STATUSES } from '@/lib/enums'
import { INVENTORY_VIEWS } from '@/components/inventory/views'

/**
 * What "needs a price" means, in the four places that answer it.
 *
 * A sold watch was turning up in the unpriced worklist, and the cause was
 * that nothing agreed on the question. There were four definitions:
 *
 *   the sidebar count      held stock, null or zero
 *   the insight's headline IN_STOCK only, null only
 *   the saved view         IN_STOCK or RESERVED, empty
 *   the list the first two linked to   any status at all, null only
 *
 * So the sidebar said seven, the list showed every unpriced watch the
 * business had ever owned, and the number read as broken. None of that is a
 * bug in one place that a test of that place would have caught — it is four
 * places quietly meaning four things, which only a test that reads all four
 * together can see. Same move as `image-audience.test.ts`.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('stock you hold', () => {
  it('is one list, not a string repeated in each query', () => {
    expect([...HELD_STATUSES]).toEqual(['IN_STOCK', 'RESERVED', 'SALE_AGREED'])
    // Every one of them is a real status. A typo here would narrow silently.
    for (const status of HELD_STATUSES) expect(WATCH_STATUSES).toContain(status)
    // And it is the statuses that are NOT a finished story.
    for (const gone of ['SOLD', 'RETURNED', 'WRITTEN_OFF']) {
      expect(HELD_STATUSES as readonly string[]).not.toContain(gone)
    }
  })

  it('is read from the shared list wherever stock is counted or queued', () => {
    for (const path of [
      'src/server/repositories/watch-repository.ts',
      'src/server/repositories/dashboard-repository.ts',
      'src/server/services/insights-service.ts',
    ]) {
      const source = read(path)
      expect(source, path).toMatch(/HELD_STATUSES/)
      // The literal that used to be written out by hand in each of them.
      expect(source, path).not.toMatch(/'IN_STOCK','RESERVED','SALE_AGREED'/)
    }
  })
})

describe('the unpriced worklist', () => {
  it('does not open a list of sold watches', () => {
    // The whole of the reported fault: `unpricedOnly` had no status filter.
    const source = read('src/server/repositories/watch-repository.ts')
    const clause = source.slice(source.indexOf('if (query.unpricedOnly)'), source.indexOf('if (query.unpricedOnly)') + 300)
    expect(clause).toMatch(/inArray\(watches\.status, \[\.\.\.HELD_STATUSES\]\)/)
  })

  it('counts a price of zero as no price, everywhere', () => {
    // An import leaves zeros behind, and the Shopify mirror already refuses
    // to publish one. A list that treated it as priced was the odd one out.
    for (const path of [
      'src/server/repositories/watch-repository.ts',
      'src/server/services/insights-service.ts',
    ]) {
      expect(read(path), path).toMatch(/or\(isNull\(watches\.estSaleGbp\), eq\(watches\.estSaleGbp, 0\)\)/)
    }
    expect(read('src/server/repositories/dashboard-repository.ts'))
      .toMatch(/is null or .*= 0/)
  })

  it('offers the same set from the saved view as from the sidebar', () => {
    const view = INVENTORY_VIEWS.find((entry) => entry.id === 'unpriced')
    expect(view).toBeDefined()
    const params = new URLSearchParams(view!.query)
    expect(params.getAll('f')).toContain(`status:is:${HELD_STATUSES.join('|')}`)
    expect(params.getAll('f')).toContain('estSaleGbp:isEmpty')
  })
})
