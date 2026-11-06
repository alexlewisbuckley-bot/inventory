import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recentBusinessMonths, businessToday } from '@/lib/dates'

const read = (path: string) => readFileSync(path, 'utf8')
const codeOf = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const commission = read('src/app/(app)/reports/commission/page.tsx')
const pnl = read('src/app/(app)/reports/pnl/page.tsx')
const costs = read('src/app/(app)/reports/costs/page.tsx')
const people = read('src/app/(app)/reports/people/page.tsx')

/**
 * Which month a report thinks it is.
 *
 * Alex: "Sales this month data is wrong and this is critical... you need to
 * understand why this happened and make sure it isn't happening on other
 * reporting this could cause a mistake in payments for commisions."
 *
 * The people report was put on the shop's clock when a sale in Dubai went
 * missing from it. Commission, profit and loss and running costs were not,
 * and each built its own month list out of `new Date()` and
 * `new Date(year, month, 1)` — both the server's clock. Dubai is four hours
 * ahead, so from midnight to 4am there the server is still on the previous
 * day, and on the first of the month that is the previous month.
 *
 * The commission report is what the business pays people from.
 */

/** What those three used to do. */
const serverWay = (now: Date) => {
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  return `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`
}

describe('the first hours of a month in Dubai', () => {
  it('were a month behind, and are not any more', () => {
    // 1 November, 2am in Dubai, is still 31 October on a UTC server.
    const now = new Date('2026-10-31T22:00:00Z')
    expect(serverWay(now)).toBe('2026-10')
    expect(recentBusinessMonths(1, now)[0]!.key).toBe('2026-11')
  })

  it('takes the year with it', () => {
    // 1 January, 1am in Dubai: the server says December, and last year.
    const now = new Date('2025-12-31T21:00:00Z')
    expect(serverWay(now)).toBe('2025-12')
    expect(recentBusinessMonths(1, now)[0]!.key).toBe('2026-01')
  })

  it('agrees with the server once Dubai is past 4am', () => {
    const now = new Date('2026-11-01T04:00:00Z')
    expect(serverWay(now)).toBe(recentBusinessMonths(1, now)[0]!.key)
  })

  it('agrees mid-month, which is why nobody caught it', () => {
    const now = new Date('2026-11-14T22:00:00Z')
    expect(serverWay(now)).toBe(recentBusinessMonths(1, now)[0]!.key)
  })
})

describe('the window a month means', () => {
  it('runs from the first at midnight UTC to the last instant of the last day', () => {
    // Sale dates are stored as the calendar day somebody picked at 00:00Z,
    // so a window of UTC midnights lines up with them exactly.
    const [november] = recentBusinessMonths(1, new Date('2026-11-14T10:00:00Z'))
    expect(november!.from.toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(november!.to.toISOString()).toBe('2026-11-30T23:59:59.999Z')
  })

  it('never ends at "now", so a sale dated later today is still in it', () => {
    const [month] = recentBusinessMonths(1, new Date('2026-11-14T10:00:00Z'))
    expect(month!.to.getTime()).toBeGreaterThan(new Date('2026-11-14T10:00:00Z').getTime())
  })

  it('walks back across a year end without losing a month', () => {
    const months = recentBusinessMonths(3, new Date('2026-01-15T10:00:00Z'))
    expect(months.map((m) => m.key)).toEqual(['2026-01', '2025-12', '2025-11'])
    expect(months.map((m) => m.label)).toEqual(['January 2026', 'December 2025', 'November 2025'])
  })

  it('labels each month by what it is, not by the arithmetic', () => {
    const months = recentBusinessMonths(13, new Date('2026-11-14T10:00:00Z'))
    expect(months[12]!.key).toBe('2025-11')
    expect(months[12]!.short).toBe('Nov')
  })

  it('does not drift on the 31st of a month', () => {
    // Rolling a month back off a 31st is where naive date arithmetic lands
    // in the wrong month entirely.
    const months = recentBusinessMonths(2, new Date('2026-10-31T10:00:00Z'))
    expect(months.map((m) => m.key)).toEqual(['2026-10', '2026-09'])
  })
})

describe('every report reads the same clock', () => {
  it('commission, profit and loss, and running costs all use it', () => {
    for (const [name, source] of [
      ['commission', commission], ['pnl', pnl], ['costs', costs],
    ] as const) {
      expect(source, name).toMatch(/recentBusinessMonths/)
    }
  })

  it('none of them builds a month from the server clock any more', () => {
    /*
     * `new Date()` for "now" and `new Date(year, month, 1)` for a bound are
     * both the server's clock. Either one on its own puts a report a month
     * out for the first four hours of a Dubai day.
     */
    for (const [name, source] of [
      ['commission', commission], ['pnl', pnl], ['costs', costs], ['people', people],
    ] as const) {
      expect(codeOf(source), name).not.toMatch(/new Date\(now\.getFullYear\(\)/)
      expect(codeOf(source), name).not.toMatch(/now\.getMonth\(\)/)
    }
  })

  it('the people report still uses the business day it was fixed with', () => {
    expect(people).toMatch(/businessToday\(\)/)
    expect(people).toMatch(/startOfMonthUtc\(year, month\)/)
  })

  it('and the helper and the people report agree about which month it is', () => {
    const now = new Date('2026-10-31T22:00:00Z')
    const { year, month } = businessToday(now)
    expect(`${year}-${String(month + 1).padStart(2, '0')}`)
      .toBe(recentBusinessMonths(1, now)[0]!.key)
  })
})

describe('what a person’s count is made of', () => {
  it('is shown, so the number can be checked', () => {
    // The column counts everything somebody brought in — a watch, a fee, a
    // buy-back charge — because that is what commission is paid on. Read as
    // watches it is simply wrong, and the bare total cannot be checked.
    expect(people).toMatch(/person\.sold !== person\.stockSold/)
    expect(people).toMatch(/in fees/)
  })
})
