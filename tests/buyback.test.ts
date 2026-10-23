import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  dueDateFor, inBase, monthlyFor, periodsElapsed, rateFor, shareOut,
} from '@/server/services/buyback-service'
import { RATE_SCALE } from '@/lib/currency'

const read = (path: string) => readFileSync(path, 'utf8')
const AED = (major: number) => major * 100

/**
 * Lending against watches.
 *
 * The customer keeps ownership. We advance a sum, hold their watches, and
 * earn interest every month until they redeem. The arithmetic is small and
 * the ways it goes quietly wrong are not, which is what these are for.
 */
describe('what a month of interest comes to', () => {
  it('works the example out', () => {
    // 200,000 AED at two and a half percent a month is 5,000 a month.
    expect(monthlyFor(AED(200_000), 250)).toBe(AED(5_000))
  })

  it('reads the rate back off an amount somebody typed', () => {
    expect(rateFor(AED(200_000), AED(5_000))).toBe(250)
  })

  it('rounds once, to the minor unit', () => {
    // A third of a fil charged every month is a figure that drifts away
    // from the invoice, and nobody can say by how much a year later.
    expect(Number.isInteger(monthlyFor(AED(33_333), 333))).toBe(true)
  })

  it('does not divide by a principal of nothing', () => {
    expect(rateFor(0, AED(5_000))).toBe(0)
  })
})

describe('how many months have been earned', () => {
  const start = new Date('2026-01-10T00:00:00Z')

  it('is none on the day it is written', () => {
    // Interest is charged in arrears. Billing on day one charges somebody
    // who redeems the same week for a month they never had.
    expect(periodsElapsed(start, start)).toBe(0)
    expect(periodsElapsed(start, new Date('2026-01-31T00:00:00Z'))).toBe(0)
  })

  it('is one on the anniversary, not the day before', () => {
    expect(periodsElapsed(start, new Date('2026-02-09T23:00:00Z'))).toBe(0)
    expect(periodsElapsed(start, new Date('2026-02-10T00:00:00Z'))).toBe(1)
  })

  it('counts whole months, not thirty-day blocks', () => {
    // February is not a short month to somebody paying by the month.
    expect(periodsElapsed(start, new Date('2026-06-10T00:00:00Z'))).toBe(5)
    expect(periodsElapsed(start, new Date('2027-01-10T00:00:00Z'))).toBe(12)
  })

  it('stops the day the loan closes', () => {
    // A loan redeemed in March does not keep earning through April
    // because nobody opened the screen until June.
    const closed = new Date('2026-03-10T00:00:00Z')
    expect(periodsElapsed(start, new Date('2026-06-10T00:00:00Z'), closed)).toBe(2)
  })

  it('handles a loan written on the 31st', () => {
    // The 31st of January plus a month is the 28th of February, not the
    // 3rd of March — which is where naive date arithmetic lands and where
    // an extra month of interest comes from.
    const endOfMonth = new Date('2026-01-31T00:00:00Z')
    expect(dueDateFor(endOfMonth, 1).toISOString().slice(0, 10)).toBe('2026-02-28')
    expect(periodsElapsed(endOfMonth, new Date('2026-02-28T00:00:00Z'))).toBe(1)
  })
})

describe('splitting the loan across the watches that secured it', () => {
  it('weighs by what each was valued at', () => {
    expect(shareOut(AED(200_000), [AED(150_000), AED(50_000)]))
      .toEqual([AED(150_000), AED(50_000)])
  })

  it('splits evenly when nothing was valued', () => {
    expect(shareOut(AED(200_000), [null, null])).toEqual([AED(100_000), AED(100_000)])
  })

  it('always adds up to exactly what was lent', () => {
    // A cost basis a fil short of the loan is a rounding error that never
    // stops being visible once it is in the ledger.
    for (const weights of [[1, 1, 1], [2, 3, 7], [null, null, null]]) {
      const parts = shareOut(100_000, weights as Array<number | null>)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(100_000)
    }
  })

  it('falls back to an even split when only some were valued', () => {
    // Weighting by a list with holes in it would quietly give the
    // unvalued ones a cost of nothing.
    expect(shareOut(AED(90_000), [AED(60_000), null])).toEqual([AED(45_000), AED(45_000)])
  })
})

describe('converting what was agreed', () => {
  it('leaves the base currency alone', () => {
    expect(inBase(AED(200_000), 'AED', {})).toEqual({ base: AED(200_000), fxRate: RATE_SCALE })
  })

  it('converts anything else through the rate table', () => {
    const { base } = inBase(1_000, 'USD', { USD: RATE_SCALE / 4 })
    expect(base).toBe(4_000)
  })
})

/**
 * The principal is not income and not a cost.
 *
 * Lending it is not an expense and getting it back is not a windfall, so
 * putting either in the ledger would make a month read as a disaster or a
 * triumph purely on which way the cash happened to move that week. Only
 * the interest and the fees are earnings.
 */
describe('where the money lands', () => {
  const ledger = read('src/server/services/sales-ledger.ts')
  const pnl = read('src/server/services/pnl-service.ts')
  const service = read('src/server/services/buyback-service.ts')

  it('puts only the charges in the ledger', () => {
    expect(ledger).toMatch(/kind: 'BUYBACK'/)
    expect(ledger).toMatch(/channel: 'BUYBACK'/)
    // The whole charge is the profit: nothing was bought.
    expect(ledger).toMatch(/profitGbp: row\.amountBase/)
    // The principal is never one of the figures on a row — only
    // mentioned in the comment saying why it is not.
    const rows = ledger.slice(ledger.indexOf('const buybackRows'))
    expect(rows.slice(0, 2000)).not.toMatch(/principalBase|principalAmount/)
  })

  it('adds the charges after gross profit, on their own line', () => {
    expect(pnl).toMatch(/trading\.grossProfit \+ brokered\.total \+ interest\.total - totalCosts/)
    expect(pnl).toMatch(/buyback: interest\.total/)
  })

  it('totals the charges and never the principal', () => {
    const from = service.indexOf('export async function buybackTotals')
    // To the end of that function, not into the next one: what is still
    // out on loan is counted elsewhere, and from the principal.
    const totals = service.slice(from, service.indexOf('\nexport ', from + 1))
    expect(totals).toMatch(/buybackCharges\.amountBase/)
    expect(totals).not.toMatch(/principalBase/)
  })

  it('counts what is lent as capital out, separately', () => {
    const reports = read('src/app/(app)/reports/page.tsx')
    expect(reports).toMatch(/inventory\.totalCostGbp \+ lent/)
  })
})

describe('the watches held as security', () => {
  const schema = read('src/server/db/migrations/0049_buybacks.sql')
  const service = read('src/server/services/buyback-service.ts')

  it('are described, not put in stock', () => {
    // Somebody else's property has no business in our inventory, in the
    // capital-deployed figure, or on the website.
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS buyback_items/)
    expect(schema).toMatch(/watch_id\s+TEXT REFERENCES watches\(id\)/)
  })

  it('become stock only on a default, at the loan value', () => {
    const fn = service.slice(service.indexOf('export async function defaultBuyback'))
    expect(fn.slice(0, 4000)).toMatch(/purchasePriceGbp: costs\[index\]/)
    expect(fn.slice(0, 4000)).toMatch(/status: 'IN_STOCK'/)
  })
})

describe('accrual', () => {
  const schema = read('src/server/db/migrations/0049_buybacks.sql')
  const service = read('src/server/services/buyback-service.ts')

  it('cannot bill the same month twice', () => {
    // Two requests landing together both find month four missing. The
    // index refuses the second; a check in JavaScript would not.
    expect(schema).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS buyback_charge_period_idx/)
    expect(service).toMatch(/isDuplicatePeriod/)
  })

  it('runs on read rather than on a schedule', () => {
    // A cron that has not fired since Friday leaves the screen lying
    // about what is owed.
    expect(service).toMatch(/export async function accrueAllOpen/)
    const list = service.slice(service.indexOf('export async function listBuybacks'))
    expect(list.slice(0, 600)).toMatch(/await accrueAllOpen\(\)/)
  })
})
