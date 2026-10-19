import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { commissionOn } from '@/server/repositories/sale-repository'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

/**
 * A profit and loss built on blanks still prints a number, and the number is
 * always too good: a cost nobody entered is a cost the report cannot charge.
 * These hold the page to saying so.
 */
describe('what the month cannot see', () => {
  const service = read('src/server/services/pnl-service.ts')
  const page = read('src/app/(app)/reports/pnl/page.tsx')
  const repo = read('src/server/repositories/sale-repository.ts')

  it('counts the sales nobody is named on', () => {
    // Commission is worked out per salesperson, so a sale with no
    // salesperson earns none at all.
    expect(repo).toMatch(/isNull\(sales\.soldById\)/)
    expect(service).toMatch(/unattributedForMonth\(from, to\)/)
  })

  it('counts the people still on a zero retainer', () => {
    expect(service).toMatch(/peopleWithoutRetainer: people\.filter\(\(person\) => person\.retainer === 0\)\.length/)
  })

  it('notices a month with no running costs at all', () => {
    expect(service).toMatch(/overheadCount: costs\.length/)
    expect(page).toMatch(/No running costs are recorded for this month/)
  })

  it('says so above the statement, not under it', () => {
    // Somebody told the month made money has already stopped reading.
    const warning = page.indexOf('What this month cannot see')
    const statement = page.indexOf('Every sale invoiced this month')
    expect(warning).toBeGreaterThan(-1)
    expect(warning).toBeLessThan(statement)
  })

  it('states what cost of stock leaves out', () => {
    // Gross profit is sale less purchase price. Servicing, shipping, duty
    // and card fees are not in it, and a reader cannot tell that from a
    // line called "cost of stock sold".
    expect(page).toMatch(/Servicing,\s*\n?\s*polishing, shipping, duty and card fees are not in it/)
  })
})

describe('the arithmetic underneath, which is not what was wrong', () => {
  it('charges a retainer whether or not the person sold anything', () => {
    // A retainer is a wage. The month it is not earned is the month it
    // matters most that the report still charges it.
    expect(commissionOn(0, 20_000_00, 2500)).toEqual({ earned: 0, commission: 0 })
  })

  it('never pays commission below the retainer', () => {
    // 25% of 7,500 is 1,875, well under a 4,085 retainer: nothing on top.
    expect(commissionOn(750_000, 408_500, 2500).commission).toBe(0)
  })

  it('pays only the part above the retainer', () => {
    // 25% of 200,000 is 50,000 against a 20,000 retainer, so 30,000 on top
    // — and the retainer is charged separately, making 50,000 in all.
    expect(commissionOn(20_000_000, 2_000_000, 2500))
      .toEqual({ earned: 5_000_000, commission: 3_000_000 })
  })

  it('earns nothing on a month that lost money, rather than a negative', () => {
    // A negative would quietly claw back the retainer.
    expect(commissionOn(-500_000, 2_000_000, 2500)).toEqual({ earned: 0, commission: 0 })
  })
})
