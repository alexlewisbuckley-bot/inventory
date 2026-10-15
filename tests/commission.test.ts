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

describe('the retainer as an advance against the share', () => {
  const RETAINER = 1_000_000 // AED 10,000
  const QUARTER = 2500

  /**
   * The rule, in one line: a quarter of the profit is what they earn, and
   * the retainer has already been paid out of it.
   *
   * It was built the other way round first — retainer off the profit, then
   * a quarter of the remainder — because both readings fit "25% of profit
   * beyond their retainer" and the worked example meant to settle it gave
   * the same answer under each. The two only diverge on real numbers, and
   * when they did, the wrong one paid a month that had not covered its own
   * advance.
   */
  it('pays nothing until the quarter covers the retainer', () => {
    // The row that caught it: AED 7,500 of profit against a AED 4,085
    // retainer earns AED 1,875 — 46% of the advance, so nothing on top.
    // The old arithmetic paid AED 854 for the same month.
    const { earned, commission } = commissionOn(750_000, 408_500, QUARTER)
    expect(earned).toBe(187_500)
    expect(commission).toBe(0)
  })

  it('pays what is left of the quarter once it does', () => {
    // AED 80,000 of profit on a AED 10,000 retainer: the quarter is
    // AED 20,000, the advance takes 10,000 of it, 10,000 is due on top.
    const { earned, commission } = commissionOn(8_000_000, RETAINER, QUARTER)
    expect(earned).toBe(2_000_000)
    expect(commission).toBe(1_000_000)
  })

  it('is a quarter of the whole profit, not of the part above the retainer', () => {
    // The distinction the two readings turn on. A quarter of 30,000 is
    // 7,500, not a quarter of (30,000 − 10,000).
    expect(commissionOn(3_000_000, RETAINER, QUARTER).earned).toBe(750_000)
    // And 750,000 does not cover the 1,000,000 advance, so nothing on top.
    expect(commissionOn(3_000_000, RETAINER, QUARTER).commission).toBe(0)
  })

  it('pays nothing extra when the quarter lands exactly on the retainer', () => {
    expect(commissionOn(4_000_000, RETAINER, QUARTER)).toEqual({ earned: 1_000_000, commission: 0 })
  })

  it('never goes negative when the month loses money', () => {
    // A watch sold under cost is a real thing, and it must not turn into a
    // negative that quietly claws back the retainer already paid.
    expect(commissionOn(-800_000, RETAINER, QUARTER)).toEqual({ earned: 0, commission: 0 })
  })

  it('claws nothing back from a month the quarter never covered', () => {
    // Fresh each month: a quiet February leaves no debt against March.
    expect(commissionOn(400_000, RETAINER, QUARTER).commission).toBe(0)
  })

  it('pays the whole share when there is no retainer to cover', () => {
    expect(commissionOn(2_000_000, 0, QUARTER)).toEqual({ earned: 500_000, commission: 500_000 })
  })

  it('rounds once, at the end', () => {
    // Rounding the profit first and the share second loses a fils per
    // person per month — nothing, until somebody reconciles against the
    // bank and cannot find it.
    expect(commissionOn(1_000_003, 0, QUARTER).earned).toBe(250_001)
    expect(commissionOn(1_000_001, 0, QUARTER).earned).toBe(250_000)
  })

  it('handles a rate that is not a quarter', () => {
    // Basis points so an eighth is representable at all.
    expect(commissionOn(2_000_000, 0, 1250).earned).toBe(250_000)
    expect(commissionOn(2_000_000, 0, 10_000).earned).toBe(2_000_000)
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
    // What is actually handed over leads, in the only accent on the row:
    // the quarter earned is context for it, not the payment.
    expect(page).toMatch(/label="Due above retainers"/)
    expect(page).toMatch(/value=\{money\(totals\.commission\)\}\s*\n?\s*tone="accent"/)
    expect(page).toMatch(/label="Earned at 25%" value=\{money\(totals\.earned\)\}/)
  })
})

describe('the view against target', () => {
  const page = read('src/app/(app)/reports/commission/page.tsx')
  const meter = read('src/components/charts/TargetMeter.tsx')

  it('measures each person against their own retainer, not against each other', () => {
    // A shared axis would say two people on different retainers were
    // racing. They are not: each track runs nought to their own hundred.
    expect(page).toMatch(/const ratio = person\.earned \/ person\.retainer/)
    expect(meter).toMatch(/Math\.min\(Math\.max\(datum\.ratio, 0\), 1\) \* 100/)
  })

  it('leaves out anybody who has no target to be measured against', () => {
    // A full track would say they had cleared something; an empty one would
    // say they had failed to.
    expect(page).toMatch(/people\.filter\(\(person\) => person\.retainer > 0\)/)
  })

  it('marks how far through the month it is, and only while it is running', () => {
    // Otherwise a meter read on the 3rd looks the same as one read on the
    // 30th, and every row is a failure for three weeks of every month.
    expect(page).toMatch(/now >= chosen\.from\.getTime\(\) && now <= chosen\.to\.getTime\(\)/)
    expect(meter).toMatch(/pace !== undefined && pace > 0 && pace < 1/)
  })

  it('never leaves a state to colour alone', () => {
    expect(meter).toMatch(/\{datum\.stateLabel\}/)
    expect(page).toMatch(/stateLabel: cleared/)
  })

  it('keeps the two fills to a pair the validator passes', () => {
    // Green cleared against amber behind is ΔE 12.7 for normal vision and
    // 5.6 under protanopia. Behind-ness is positional instead.
    expect(meter).not.toMatch(/bg-state-warning|bg-state-serious|bg-state-critical/)
    expect(meter).toMatch(/cleared: 'bg-state-good'/)
  })

  it('offers the figures and the meters as two views of one month', () => {
    expect(page).toMatch(/searchParams\.view === 'target' \? 'target' : 'figures'/)
    expect(page).toMatch(/'Against target'/)
  })
})

describe('the meter track', () => {
  const meter = read('src/components/charts/TargetMeter.tsx')

  it('is neutral, because the sequential ramp inverts between themes', () => {
    // chart-seq-1 is a near-white blue in light and a saturated navy in
    // dark. As a track on a near-black surface the navy reads as a full
    // bar, so nought per cent looked like a cleared target.
    expect(meter).toMatch(/rounded-pill bg-surface-subtle/)
    expect(meter).not.toMatch(/bg-chart-seq-1/)
  })
})
