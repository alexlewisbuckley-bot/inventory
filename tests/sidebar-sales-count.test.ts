import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const layout = readFileSync(join(process.cwd(), 'src/app/(app)/layout.tsx'), 'utf8')
const page = readFileSync(join(process.cwd(), 'src/app/(app)/sales/page.tsx'), 'utf8')

/**
 * The badge and the page it points at have to agree.
 *
 * The ledger counts a brokered deal as a sale — its own comment says a header
 * counting it apart from the rows beside it would be describing a different
 * table — so the page said twelve. The sidebar counted sale rows alone and
 * said nine. Of the two numbers, the one you see without opening anything is
 * the one that gets believed, so the sidebar was the wrong place to be short.
 *
 * Pinned in the source rather than against a database, because the fault was
 * never in the data: both numbers were correct counts of different things.
 */
describe('the sidebar sales badge', () => {
  it('counts brokered deals, as the sales page does', () => {
    expect(page).toMatch(/summary\.count \+ brokerTotals\.count/)
    expect(layout).toMatch(/sales:[^\n]*saleCount[^\n]*brokerCount/)
  })

  it('leaves out voided and deleted brokerages, as the ledger does', () => {
    // A cancelled brokerage is not a sale, exactly as a voided invoice is
    // not. Counting it would make the badge wrong in the other direction.
    expect(layout).toMatch(/from\(brokerages\)[\s\S]{0,160}?isNull\(brokerages\.voidedAt\)/)
    expect(layout).toMatch(/from\(brokerages\)[\s\S]{0,160}?isNull\(brokerages\.deletedAt\)/)
  })

  it('still counts the sale rows through the shared predicate', () => {
    // liveSale() is the one definition of a sale that still counts, and
    // tests/sale-filters.test.ts exists to stop it being hand-written.
    expect(layout).toMatch(/from\(sales\)\.where\(liveSale\(\)\)/)
  })
})
