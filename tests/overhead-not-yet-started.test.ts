import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appliesInMonth, monthlyCost } from '@/server/repositories/overhead-repository'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

/**
 * The rent was entered correctly and charged nothing.
 *
 * A real case: AED 21,557 a month, recorded as starting November 2026, read
 * in October 2026. Nothing was wrong with the arithmetic — October simply
 * came before the cost existed — and the only sign of it anywhere was a dash
 * in the per-month column of a table. The profit figure said the month cost
 * AED 59,317 to run, which was true of the data and not of the business.
 */
const rent = { cadence: 'MONTHLY' as const, startsOn: '2026-11-01', endsOn: null }

describe('a cost that has not started yet', () => {
  it('is charged nothing in the month before it begins', () => {
    expect(appliesInMonth(rent, '2026-10-01', '2026-10-31')).toBe(false)
  })

  it('is charged in full from the month it does begin', () => {
    expect(appliesInMonth(rent, '2026-11-01', '2026-11-30')).toBe(true)
    expect(monthlyCost(2_155_700, 'MONTHLY')).toBe(2_155_700)
  })

  it('is charged from its first month when it started mid-month', () => {
    // Rent agreed on the 12th is rent owed for that month.
    expect(appliesInMonth({ ...rent, startsOn: '2026-11-12' }, '2026-11-01', '2026-11-30')).toBe(true)
  })

  it('stops being charged after it ends', () => {
    const ended = { ...rent, startsOn: '2026-01-01', endsOn: '2026-09-30' }
    expect(appliesInMonth(ended, '2026-09-01', '2026-09-30')).toBe(true)
    expect(appliesInMonth(ended, '2026-10-01', '2026-10-31')).toBe(false)
  })
})

describe('saying so, rather than printing a dash', () => {
  it('separates nothing recorded from nothing that applies yet', () => {
    // Two failures that look identical on the bottom line and need
    // completely different actions: enter the cost, or fix its date.
    const page = read('src/app/(app)/reports/pnl/page.tsx')
    expect(page).toMatch(/No running costs are recorded at all/)
    expect(page).toMatch(/statement\.blindSpots\.startingLater\.length > 0/)
    expect(page).toMatch(/correct the start date/)
  })

  it('counts what exists separately from what this month charges', () => {
    const repo = read('src/server/repositories/overhead-repository.ts')
    expect(repo).toMatch(/export async function overheadCoverage/)
    expect(repo).toMatch(/startingLater: rows/)
  })

  it('tells the table row which way it missed', () => {
    const manager = read('src/components/reports/RunningCostsManager.tsx')
    expect(manager).toMatch(/from \$\{formatDay\(cost\.startsOn\)\}/)
    expect(manager).toMatch(/ended \$\{formatDay\(cost\.endsOn\)\}/)
    expect(manager).toMatch(/'paused'/)
  })
})
