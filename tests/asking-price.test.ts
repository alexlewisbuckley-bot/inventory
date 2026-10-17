import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { askingPrice, PRICE_STEP } from '@/lib/money'

/**
 * Asking prices sit on a AED 250 ladder.
 *
 * The rule exists because the dollar-era rebase left eleven live listings
 * carrying fils — a round $20,000 is AED 73,450.02, correctly and
 * uselessly — and one that came back a single fil short of AED 74,750.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('the asking-price ladder', () => {
  it('is AED 250', () => {
    expect(PRICE_STEP).toBe(25_000)
  })

  it('always rounds up, never down', () => {
    // Downward would quietly take money off a price somebody set. The most
    // this can ever add is AED 249.99.
    expect(askingPrice(7_474_999)).toBe(7_475_000)   // 74,749.99 -> 74,750
    expect(askingPrice(7_345_002)).toBe(7_350_000)   // 73,450.02 -> 73,500
    expect(askingPrice(16_526_255)).toBe(16_550_000) // 165,262.55 -> 165,500
    expect(askingPrice(2_260_000)).toBe(2_275_000)   // 22,600 -> 22,750
  })

  it('leaves a price already on the ladder exactly where it is', () => {
    expect(askingPrice(4_400_000)).toBe(4_400_000)   // 44,000
    expect(askingPrice(7_475_000)).toBe(7_475_000)   // 74,750
  })

  it('never adds more than one step', () => {
    for (const minor of [1, 24_999, 25_001, 7_474_999, 99_999_999]) {
      const up = askingPrice(minor)!
      expect(up).toBeGreaterThanOrEqual(minor)
      expect(up - minor).toBeLessThan(PRICE_STEP)
      expect(up % PRICE_STEP).toBe(0)
    }
  })

  it('passes a missing price through rather than inventing one', () => {
    // A blank estimate has to stay blank: zero would report the watch as a
    // total loss instead of putting it on the "needs a price" worklist.
    expect(askingPrice(null)).toBeNull()
    expect(askingPrice(undefined)).toBeNull()
    expect(askingPrice(0)).toBe(0)
  })
})

describe('where the ladder is applied', () => {
  it('catches a price typed in by hand, on the way in and on an edit', () => {
    const service = read('src/server/services/watch-service.ts')
    expect(service.match(/askingPrice\(/g)?.length).toBe(2)
  })

  it('catches a price arriving on a spreadsheet', () => {
    const service = read('src/server/services/import-service.ts')
    expect(service).toMatch(/const base = askingPrice\(toMinor\(estimateMajor\)\)!/)
  })

  it('rounds the import preview by the same rule as the import write', () => {
    // Rounding only on write would make every import report "retail
    // changed" for ever, because the sheet's figure would never match the
    // stored one again.
    const service = read('src/server/services/import-service.ts')
    expect(service).toMatch(/const proposedRetail = proposed\.estSaleGbp === null \? null : askingPrice\(/)
  })

  it('leaves what was paid and what was agreed alone', () => {
    // A purchase price is what an invoice says and a sale is what was
    // agreed. Rounding either would invent a figure nobody can check.
    const service = read('src/server/services/watch-service.ts')
    expect(service).not.toMatch(/askingPrice\(purchase/i)
    expect(service).not.toMatch(/purchasePriceGbp = askingPrice/)
    expect(service).not.toMatch(/saleAmountGbp: askingPrice/)
  })
})

describe('the one-off repair', () => {
  const sql = read('src/server/db/migrations/0043_asking_prices_on_the_ladder.sql')

  it('rounds up, in the same direction as the rule', () => {
    expect(sql).toMatch(/ceil\(est_sale_gbp::NUMERIC \/ step\) \* step/)
    expect(sql).not.toMatch(/\bfloor\(|\bround\(est_sale_gbp/)
  })

  it('leaves sold stock alone', () => {
    // What we were asking when a watch sold is a matter of record.
    expect(sql).toMatch(/status <> 'SOLD'/)
  })

  it('touches only the retail columns', () => {
    expect(sql).not.toMatch(/purchase_price|sale_amount_gbp|profit_gbp|trade_price/)
  })

  it('refuses to finish with anything left off the ladder', () => {
    expect(sql).toMatch(/RAISE EXCEPTION 'An asking price is still off the AED 250 ladder\.'/)
  })
})

describe('whether anybody is told', () => {
  it('says so on the field rather than silently moving the number', () => {
    // Typing 74,100 and getting 74,250 back is correct and startling. The
    // rule is cheap to state and expensive to discover.
    expect(read('src/components/inventory/WatchForm.tsx'))
      .toMatch(/Rounded up to the nearest AED 250/)
  })
})
