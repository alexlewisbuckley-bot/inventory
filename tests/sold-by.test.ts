import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Who sold the watch.
 *
 * The ledger recorded `recorded_by_id` — whoever typed the sale in — and that
 * is a different question. The person at the counter and the person at the
 * keyboard are often not the same, and on a busy day one books in the other's
 * sales. Attributing a month to whoever happened to be sitting down is how a
 * sales report stops being read.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('the field', () => {
  it('is on every screen that books a sale', () => {
    // It shipped on one of the two and not the other, and because the field
    // was hidden when the list came back empty, the half that was missed
    // looked exactly like the half that worked. Whichever way somebody opens
    // "Mark as sold", it is the same dialog and it has to be given the same
    // list.
    for (const path of [
      'src/components/inventory/InventoryList.tsx',
      'src/components/inventory/WatchDrawerClient.tsx',
    ]) {
      const source = read(path)
      const at = source.indexOf('<QuickSellModal')
      expect(at, `${path} renders the sell dialog`).toBeGreaterThan(-1)
      expect(source.slice(at, at + 400), path).toMatch(/salesPeople=\{salesPeople\}/)
    }
  })

  it('is fed from the server on both routes in', () => {
    for (const path of [
      'src/app/(app)/inventory/page.tsx',
      'src/components/inventory/WatchDrawer.tsx',
      'src/app/(app)/sales/page.tsx',
    ]) {
      expect(read(path), path).toMatch(/listSalesPeople\(\)/)
    }
  })

  it('is never hidden for want of a list', () => {
    // The guard read as careful and was not: the list is seeded by migration,
    // so empty only ever means the prop did not arrive. A field that
    // disappears is a bug nobody can see.
    for (const path of [
      'src/components/inventory/QuickSellModal.tsx',
      'src/components/sales/EditSaleModal.tsx',
    ]) {
      expect(read(path), path).not.toMatch(/salesPeople\.length > 0 &&/)
      expect(read(path), path).toMatch(/label="Sold by"/)
    }
  })

  it('credits nobody by default', () => {
    // Not the person signed in. A name credited by accident is worse than a
    // blank the report can tell you about.
    const modal = read('src/components/inventory/QuickSellModal.tsx')
    expect(modal).toMatch(/const \[soldById, setSoldById\] = useState\(''\)/)
    expect(modal).toMatch(/placeholder="Not recorded"/)
  })
})

describe('what it is worth later', () => {
  it('survives a sale being corrected', () => {
    // Otherwise the one screen for fixing a mis-booked sale is the screen
    // that silently clears the attribution.
    const service = read('src/server/services/watch-service.ts')
    const amend = service.slice(service.indexOf('export async function amendSale'))
    expect(amend.slice(0, 9000)).toMatch(/soldById: input\.soldById \?\? null/)
    expect(amend.slice(0, 9000)).toMatch(/'soldById'/)
  })

  it('counts the sales nobody is recorded against, rather than dropping them', () => {
    // A report that quietly omits them makes the totals disagree with the
    // ledger and nobody can see why.
    const repo = read('src/server/repositories/sale-repository.ts')
    const query = repo.slice(repo.indexOf('export async function salesByPerson'))
    expect(query.slice(0, 1800)).toMatch(/coalesce\(\$\{salesPeople\.name\}, 'Not recorded'\)/)
    expect(query.slice(0, 1800)).toMatch(/leftJoin\(salesPeople/)
  })

  it('leaves a voided invoice out of anybody’s figures', () => {
    const repo = read('src/server/repositories/sale-repository.ts')
    const query = repo.slice(repo.indexOf('export async function salesByPerson'))
    expect(query.slice(0, 1800)).toMatch(/liveSale\(\)/)
  })

  it('does not drop a sale from the ledger for having nobody against it', () => {
    // An inner join here would hide every sale booked before the list
    // existed — which is all of them, on the day it ships.
    const repo = read('src/server/repositories/sale-repository.ts')
    expect(repo).toMatch(/\.leftJoin\(salesPeople, eq\(salesPeople\.id, sales\.soldById\)\)/)
  })
})
