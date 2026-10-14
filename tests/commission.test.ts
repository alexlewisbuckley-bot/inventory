import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { commissionOn } from '@/server/repositories/sale-repository'
import { reportTabs } from '@/components/reports/tabs'
import { formatShare } from '@/lib/money'
import { changeValue, fieldLabel } from '@/lib/audit-format'

/**
 * What a salesperson is paid.
 *
 * A retainer every month, and a quarter of the profit on their own sales
 * above it. The arithmetic is six lines and somebody's wages depend on it,
 * which is exactly the ratio that earns a test file of its own.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('the share above the retainer', () => {
  const RETAINER = 1_000_000 // AED 10,000
  const QUARTER = 2500

  it('pays a quarter of what clears the retainer', () => {
    // AED 30,000 profit against a AED 10,000 retainer: 20,000 clears it,
    // and a quarter of that is 5,000.
    const { above, commission } = commissionOn(3_000_000, RETAINER, QUARTER)
    expect(above).toBe(2_000_000)
    expect(commission).toBe(500_000)
  })

  it('pays nothing on a month that does not clear it', () => {
    // And owes nothing forward: fresh each month, so a quiet February does
    // not raise March's threshold.
    expect(commissionOn(400_000, RETAINER, QUARTER)).toEqual({ above: 0, commission: 0 })
  })

  it('never goes negative when the month loses money', () => {
    // A watch sold under cost is a real thing, and it must not turn into a
    // negative commission that quietly claws back the retainer.
    expect(commissionOn(-800_000, RETAINER, QUARTER)).toEqual({ above: 0, commission: 0 })
  })

  it('pays nothing extra at exactly the retainer', () => {
    expect(commissionOn(RETAINER, RETAINER, QUARTER)).toEqual({ above: 0, commission: 0 })
  })

  it('pays the whole share when there is no retainer to clear', () => {
    expect(commissionOn(2_000_000, 0, QUARTER).commission).toBe(500_000)
  })

  it('rounds once, at the end', () => {
    // Rounding the profit first and the share second loses a fils per person
    // per month — nothing, until somebody reconciles against the bank and
    // cannot find it.
    expect(commissionOn(1_000_003, 0, QUARTER).commission).toBe(250_001)
    expect(commissionOn(1_000_001, 0, QUARTER).commission).toBe(250_000)
  })

  it('handles a rate that is not a quarter', () => {
    // Basis points so an eighth is representable at all.
    expect(commissionOn(2_000_000, 0, 1250).commission).toBe(250_000)
    expect(commissionOn(2_000_000, 0, 10_000).commission).toBe(2_000_000)
  })
})

describe('whose profit clears it', () => {
  const repo = read('src/server/repositories/sale-repository.ts')
  const query = repo.slice(repo.indexOf('export async function commissionForMonth'))

  it('is their own sales, not the month’s total', () => {
    expect(query.slice(0, 2600)).toMatch(/\.groupBy\(sales\.soldById\)/)
  })

  it('counts paid and unpaid apart, and returns both', () => {
    // Which one a commission is owed on is a decision about money that
    // belongs to whoever signs the cheque. Showing only the paid figure
    // hides what is coming; showing only the total pays somebody for an
    // invoice the customer has not settled.
    expect(query.slice(0, 2600)).toMatch(/filter \(where \$\{sales\.paymentStatus\} = 'PAID'\)/)
    expect(query.slice(0, 2600)).toMatch(/filter \(where \$\{sales\.paymentStatus\} <> 'PAID'\)/)
  })

  it('leaves a voided invoice out of anybody’s figures', () => {
    expect(query.slice(0, 2600)).toMatch(/liveSale\(\)/)
  })

  it('lists everybody active, including the people who sold nothing', () => {
    // A commission run listing only the earners silently drops the person on
    // a retainer and no sales — precisely the one somebody needs to see.
    expect(query.slice(0, 2600)).toMatch(/\.from\(salesPeople\)\n\s+\.leftJoin\(earned/)
    expect(query.slice(0, 2600)).toMatch(/eq\(salesPeople\.isActive, true\)/)
  })
})

describe('who can open the page', () => {
  it('shows the tab to whoever may see every salesperson’s figures', () => {
    expect(reportTabs('OWNER').map((tab) => tab.href)).toContain('/reports/commission')
    expect(reportTabs('MANAGER').map((tab) => tab.href)).toContain('/reports/commission')
  })

  it('keeps it off the row for somebody who may see only their own', () => {
    // A salesperson's own commission is a conversation with their manager,
    // not a page — and the same page would show them everybody else's
    // retainer, which is the one number on it that is nobody's business.
    expect(reportTabs('SALES').map((tab) => tab.href)).not.toContain('/reports/commission')
  })

  it('guards the page on the same capability the tab is drawn from', () => {
    const page = read('src/app/(app)/reports/commission/page.tsx')
    expect(page).toMatch(/requireCapability\('report:read'\)/)
  })
})

describe('how the share reads', () => {
  it('drops the decimals nobody asked for', () => {
    expect(formatShare(2500)).toBe('25%')
    expect(formatShare(1250)).toBe('12.5%')
    expect(formatShare(0)).toBe('0%')
    expect(formatShare(10_000)).toBe('100%')
  })
})

describe('what the audit trail says about pay', () => {
  it('reads a retainer as money and a share as a percentage', () => {
    // The same bug twice over otherwise: a retainer printed as 1500000 and a
    // share printed as 2500, on the one screen somebody opens when a wage
    // looks wrong.
    expect(changeValue(1_500_000, 'retainer')).toMatch(/15,000/)
    expect(changeValue(2500, 'commissionBps')).toBe('25%')
    expect(fieldLabel('retainer')).toBe('Monthly retainer')
    expect(fieldLabel('commissionBps')).toBe('Commission share')
  })
})

describe('which build touches the live database', () => {
  const setup = read('src/server/db/cli-setup.ts')

  it('leaves it alone on anything but a production deployment', () => {
    // Preview here shares the production DATABASE_URL, so a push to a branch
    // was migrating the shop. Once it left the database rebased to dirhams
    // while the site still ran the dollar code.
    expect(setup).toMatch(/const target = process\.env\.VERCEL_ENV/)
    expect(setup).toMatch(/if \(target && target !== 'production'\)/)
  })

  it('checks before it opens a connection', () => {
    expect(setup.indexOf('VERCEL_ENV')).toBeLessThan(setup.indexOf("await import('./client')"))
  })
})

describe('where the numbers are set', () => {
  const page = read('src/app/(app)/reports/commission/page.tsx')

  it('points at the page that sets them', () => {
    // Every other figure on this report is derived. The two that are typed
    // are set somewhere else entirely, and nothing on the page said where.
    expect(page).toMatch(/href="\/sales-people"/)
  })

  it('says so differently when none is set yet', () => {
    expect(page).toMatch(/Nobody has a retainer yet/)
  })

  it('names a retainer nobody has filled in rather than printing a zero', () => {
    // A recorded zero and an unanswered question look identical in that
    // column, and they pay out very differently: on zero, commission runs
    // from the first dirham of profit.
    expect(page).toMatch(/person\.retainer > 0\s*\n?\s*\? money\(person\.retainer\)/)
    expect(page).toMatch(/Not set/)
    expect(page).toMatch(/const missing = people\.filter\(\(person\) => person\.retainer === 0\)/)
  })

  it('does not call the retainers-plus-commission total "payable"', () => {
    // It was the biggest figure on the page, in the same accent green as
    // the commission beside it, and it read as a commission bill five times
    // the size of the real one.
    expect(page).not.toMatch(/label="Payable(\s|")/)
    expect(page).toMatch(/label="Total pay"/)
    expect(page).toMatch(/label="Commission earned" value=\{money\(totals\.commission\)\} tone="accent"/)
  })
})
