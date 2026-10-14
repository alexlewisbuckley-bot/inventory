import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { monthlyCost, appliesInMonth } from '@/server/repositories/overhead-repository'
import { isoDate } from '@/server/services/pnl-service'
import { reportTabs } from '@/components/reports/tabs'
import { can } from '@/lib/permissions'

/**
 * What the business costs to run.
 *
 * The failure mode here is not an error message. A bad row produces a
 * plausible net profit that somebody then makes a decision on, so the
 * arithmetic that turns an invoice into a month's charge is worth pinning.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('what a cost comes to per month', () => {
  it('leaves a monthly bill alone', () => {
    expect(monthlyCost(500_000, 'MONTHLY')).toBe(500_000)
  })

  it('spreads a quarterly bill across its three months', () => {
    // Not landed whole in the month the invoice falls: that reports one
    // month as a disaster and the other two as better than they were.
    expect(monthlyCost(900_000, 'QUARTERLY')).toBe(300_000)
  })

  it('spreads a yearly bill across twelve', () => {
    expect(monthlyCost(1_200_000, 'ANNUAL')).toBe(100_000)
  })

  it('does not spread a one-off', () => {
    // It belongs to its month and nowhere else, which is the whole
    // difference between it and the others.
    expect(monthlyCost(750_000, 'ONE_OFF')).toBe(750_000)
  })

  it('rounds to the fils rather than carrying a fraction', () => {
    expect(monthlyCost(1_000_000, 'QUARTERLY')).toBe(333_333)
    expect(monthlyCost(100_000, 'ANNUAL')).toBe(8_333)
  })
})

describe('which months a cost belongs to', () => {
  const march = ['2026-03-01', '2026-03-31'] as const
  const ongoing = { cadence: 'MONTHLY' as const, startsOn: '2026-01-01', endsOn: null }

  it('charges a cost that was running all month', () => {
    expect(appliesInMonth(ongoing, ...march)).toBe(true)
  })

  it('does not rewrite the months before it started', () => {
    // Adding the rent today must not restate last year's profit.
    expect(appliesInMonth({ ...ongoing, startsOn: '2026-04-01' }, ...march)).toBe(false)
  })

  it('stops charging after it ended', () => {
    expect(appliesInMonth({ ...ongoing, endsOn: '2026-02-28' }, ...march)).toBe(false)
  })

  it('charges the month it started and the month it ended', () => {
    expect(appliesInMonth({ ...ongoing, startsOn: '2026-03-31' }, ...march)).toBe(true)
    expect(appliesInMonth({ ...ongoing, endsOn: '2026-03-01' }, ...march)).toBe(true)
  })

  it('puts a one-off in its own month alone', () => {
    const once = { cadence: 'ONE_OFF' as const, startsOn: '2026-03-15', endsOn: null }
    expect(appliesInMonth(once, ...march)).toBe(true)
    expect(appliesInMonth(once, '2026-04-01', '2026-04-30')).toBe(false)
    expect(appliesInMonth(once, '2026-02-01', '2026-02-28')).toBe(false)
  })
})

describe('the date a month starts on', () => {
  it('is the local date, not the UTC one', () => {
    // toISOString converts to UTC, which hands back the last day of the
    // previous month anywhere east of Greenwich — Dubai included. A
    // one-off dated the 1st would then be charged to the month before.
    expect(isoDate(new Date(2026, 2, 1))).toBe('2026-03-01')
    expect(isoDate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('who may change the cost base', () => {
  it('is the owner, and nobody else', () => {
    // Reading the P&L is report:read like any other figure. The rent and
    // the payroll are what a net profit is built on, so seeing the
    // statement must not carry the right to rewrite it.
    expect(can('OWNER', 'overhead:manage')).toBe(true)
    expect(can('MANAGER', 'overhead:manage')).toBe(false)
    expect(can('STAFF', 'overhead:manage')).toBe(false)
    expect(can('SALES', 'overhead:manage')).toBe(false)
  })

  it('guards both actions on it', () => {
    const actions = read('src/app/actions/overheads.ts')
    expect(actions.match(/requireCapability\('overhead:manage'\)/g)).toHaveLength(2)
  })

  it('still lets a manager read the statement', () => {
    expect(reportTabs('MANAGER').map((tab) => tab.href)).toContain('/reports/pnl')
    expect(reportTabs('MANAGER').map((tab) => tab.href)).toContain('/reports/costs')
  })

  it('shows neither to somebody who may only see their own sales', () => {
    const own = reportTabs('SALES').map((tab) => tab.href)
    expect(own).not.toContain('/reports/pnl')
    expect(own).not.toContain('/reports/costs')
  })
})

describe('where the wages come from', () => {
  const service = read('src/server/services/pnl-service.ts')

  it('reads retainers and commission rather than letting them be typed', () => {
    // The one guard against paying somebody twice on paper. A salary field
    // on the overheads table would make double counting a typo away.
    expect(service).toMatch(/commissionForMonth/)
    expect(service).toMatch(/person\.retainer/)
    // No column to put one in, so double counting is not a typo away. The
    // migration mentions retainers only to say they are read from
    // elsewhere, hence matching the column definition rather than the word.
    expect(read('src/server/db/migrations/0042_overheads.sql'))
      .not.toMatch(/^\s*retainer\s+INTEGER/mi)
    expect(read('src/components/reports/RunningCostsManager.tsx'))
      .not.toMatch(/name="retainer"/)
  })

  it('accrues commission on the whole month, not just what has been paid', () => {
    // The revenue on an unpaid invoice is counted a few lines above it, so
    // leaving its commission out would flatter the month.
    expect(service).toMatch(/Number\(person\.paidProfit\) \+ Number\(person\.pendingProfit\)/)
  })

  it('still reports what is payable now, so the two screens can be reconciled', () => {
    expect(service).toMatch(/commissionPayable/)
    expect(read('src/app/(app)/reports/pnl/page.tsx')).toMatch(/payable now/)
  })
})

describe('the statement', () => {
  const page = read('src/app/(app)/reports/pnl/page.tsx')

  it('derives the cost of stock so the three lines must add up', () => {
    // Summing the watch cost separately would let a corrected sale leave
    // gross profit disagreeing with its own arithmetic.
    expect(read('src/server/repositories/sale-repository.ts'))
      .toMatch(/costOfStock: invoiced - grossProfit/)
  })

  it('counts a sale in the month it was invoiced, paid or not', () => {
    expect(page).toMatch(/whether or not it has been paid/)
    expect(read('src/server/repositories/sale-repository.ts'))
      .toMatch(/export async function tradingForMonth/)
  })

  it('says what was actually received beside what was earned', () => {
    expect(page).toMatch(/statement\.received/)
    expect(page).toMatch(/statement\.unpaid/)
  })

  it('draws a loss as a loss', () => {
    // Net profit is signed, so a bar from nought is the wrong form: a loss
    // clamped to zero is an empty row that reads as "no data", and drawn
    // upward it states the opposite of what happened. Six loss-making
    // months rendered as six empty bars before this.
    expect(page).toMatch(/<DivergingBar/)
    expect(page).not.toMatch(/Math\.max\(pnl\.netProfit, 0\)/)
    const chart = read('src/components/charts/DivergingBar.tsx')
    expect(chart).toMatch(/const loss = datum\.value < 0/)
    expect(chart).toMatch(/bg-chart-div-1/)
    expect(chart).toMatch(/bg-chart-div-5/)
  })

  it('puts the zero line where the data puts it', () => {
    // Fixing it at the middle wastes half the width whenever a run of
    // months is all one sign, which is exactly when it is being read.
    const chart = read('src/components/charts/DivergingBar.tsx')
    expect(chart).toMatch(/const zeroAt = span === 0 \? 50 : \(worst \/ span\) \* 100/)
  })
})

describe('how a loss is punctuated', () => {
  it('uses one minus sign down the column', () => {
    // The deduction rows render U+2212 and the totals were falling through
    // to Intl's hyphen, so a loss was punctuated differently from the costs
    // that caused it.
    const page = readFileSync(join(process.cwd(), 'src/app/(app)/reports/pnl/page.tsx'), 'utf8')
    expect(page).toMatch(/line\.value < 0\s*\n\s*\? `− \$\{money\(Math\.abs\(line\.value\)\)\}`/)
  })
})
