import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Ticking people off the customer book.
 *
 * The list had no way to act on more than one person at a time, so clearing
 * out a page of half-finished records meant opening each one.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const table = read('src/components/crm/CustomerTable.tsx')

describe('the ticks', () => {
  it('appear only for somebody who can act on them', () => {
    // A checkbox whose only action is one the reader cannot take is a column
    // of furniture.
    expect(table).toMatch(/\{canDelete && \(\n\s+<TH width="48px">/)
    expect(read('src/app/(app)/customers/page.tsx'))
      .toMatch(/canDelete=\{can\(user\.role, 'customer:delete'\)\}/)
  })

  it('do not open the person they are ticking', () => {
    // The row is a link to the record. Ticking somebody and landing on their
    // page instead is the small betrayal that makes people stop trusting a
    // checkbox.
    expect(table).toMatch(/onClick=\{\(event\) => event\.stopPropagation\(\)\}/)
  })

  it('reuse the selection the stock list uses', () => {
    // The arithmetic of "all on this page" is where this goes wrong, and it
    // is already written and already tested.
    expect(table).toMatch(/useSelection\(result\.total\)/)
    expect(table).toMatch(/selection\.togglePage\(pageIds\)/)
  })
})

describe('the removal', () => {
  const service = read('src/server/services/crm-service.ts')

  it('says what is at stake rather than asking whether you are sure', () => {
    // The people who matter here are the ones with invoices against them.
    expect(table).toMatch(/\$\{withPurchases\} of them \$\{withPurchases === 1 \? 'has' : 'have'\} bought from you/)
    expect(table).toMatch(/hidden from the book, not erased/)
  })

  it('is one transaction, not a loop of them', () => {
    // Half a tidy-up is worse than none, because nobody can tell which half
    // ran.
    const fn = service.slice(service.indexOf('export async function deleteCustomers'))
    expect(fn.slice(0, 1400)).toMatch(/return withTransaction\(async \(\) => \{/)
    expect(fn.slice(0, 1400)).toMatch(/\.set\(\{ deletedAt: now, updatedAt: now \}\)/)
  })

  it('still writes a line per person', () => {
    // "7 customers removed" is unreadable later, when the only question
    // anybody asks of this log is whether one particular person was deleted
    // and by whom.
    const fn = service.slice(service.indexOf('export async function deleteCustomers'))
    expect(fn.slice(0, 1400)).toMatch(/for \(const row of found\) \{\n\s+await recordAudit/)
  })

  it('never hard-deletes somebody the ledger refers to', () => {
    // Soft delete throughout: the sales keep pointing at them.
    const fn = service.slice(service.indexOf('export async function deleteCustomers'))
    expect(fn.slice(0, 1400)).not.toMatch(/db\.delete\(customers\)/)
  })

  it('refuses a selection too big to have been meant', () => {
    expect(read('src/app/actions/crm.ts')).toMatch(/ids\.length > 200/)
    expect(read('src/app/actions/crm.ts')).toMatch(/requireCapability\('customer:delete'\)/)
  })
})
