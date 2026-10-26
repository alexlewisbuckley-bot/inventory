import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { commissionOn, commissionOverMonths } from '@/server/repositories/sale-repository'

const page = readFileSync(join(process.cwd(), 'src/app/(app)/reports/people/page.tsx'), 'utf8')

/** Terms a salesperson is created on: a quarter of the profit, over a retainer. */
const BPS = 2500
const RETAINER = 10_000
const month = (m: string, paidProfit: number, pendingProfit = 0) => ({ month: m, paidProfit, pendingProfit })

/**
 * What a salesperson is shown about their own month.
 *
 * Alex: "commision is paid on 25% of profit we can display that to sales
 * staff and also their retainer amount if they have one which they have to
 * surpass."
 */
describe('commission as a salesperson sees it', () => {
  it('is a quarter of the profit, less the retainer already drawn', () => {
    expect(commissionOn(100_000, RETAINER, BPS)).toEqual({ earned: 25_000, commission: 15_000 })
  })

  it('pays nothing for a month that never cleared the retainer', () => {
    expect(commissionOn(20_000, RETAINER, BPS)).toEqual({ earned: 5_000, commission: 0 })
  })

  it('never claws the retainer back out of a losing month', () => {
    expect(commissionOn(-50_000, RETAINER, BPS)).toEqual({ earned: 0, commission: 0 })
  })

  /**
   * The reason a quarter is not simply a bigger month.
   *
   * The retainer is monthly and a quiet month owes nothing forward, so
   * three months are three settlements. Taking the share of the lump sum
   * and deducting one retainer pays somebody for two months they never
   * cleared — here, AED 5,000 they did not earn.
   */
  it('settles each month separately over a longer period', () => {
    const months = [month('2026-08', 100_000), month('2026-09', 0), month('2026-10', 20_000)]
    const result = commissionOverMonths(months, RETAINER, BPS)

    expect(result.paidCommission).toBe(15_000)

    const lumpSum = commissionOn(120_000, RETAINER, BPS).commission
    expect(lumpSum).toBe(20_000)
    expect(result.paidCommission).toBeLessThan(lumpSum)
  })

  it('counts how many months got past the retainer', () => {
    const months = [month('2026-08', 100_000), month('2026-09', 0), month('2026-10', 20_000)]
    expect(commissionOverMonths(months, RETAINER, BPS)).toMatchObject({ clearedMonths: 1, months: 3 })
  })

  it('keeps an unpaid invoice out of what has been earned', () => {
    // One settled month and one month riding entirely on an unpaid invoice:
    // earned is the first alone, projected is both.
    const months = [month('2026-09', 100_000), month('2026-10', 0, 100_000)]
    const result = commissionOverMonths(months, RETAINER, BPS)
    expect(result.paidCommission).toBe(15_000)
    expect(result.projectedCommission).toBe(30_000)
  })

  it('reports the share before the retainer, so a shortfall can be shown', () => {
    // 25% of 20,000 is 5,000 against a 10,000 retainer: 5,000 still to cover.
    const result = commissionOverMonths([month('2026-10', 20_000)], RETAINER, BPS)
    expect(result.projectedEarned).toBe(5_000)
    expect(RETAINER * result.months - result.projectedEarned).toBe(5_000)
  })

  it('honours terms that are not the default 25%', () => {
    expect(commissionOverMonths([month('2026-10', 100_000)], 0, 1_000).paidCommission).toBe(10_000)
  })

  it('shows somebody their own figures and nobody else’s', () => {
    // Keyed on the salesperson the reader is linked to, never on the URL.
    expect(page).toContain('me ? earningsByPersonMonth(from, to, me.id) : Promise.resolve([])')
    expect(page).toContain('me ? dealsFor(me.id, from, to) : Promise.resolve([])')
    expect(page).toContain('commissionOverMonths(commissionMonths, me.retainer, me.commissionBps)')
  })

  it('states the rate from the person’s own terms rather than hard-coding it', () => {
    expect(page).toContain('formatShare(me.commissionBps)')
    expect(page).not.toContain('25% of profit`')
  })

  /**
   * Alex: "Brokered deals are pure profit, ignore them for Margin" and
   * "commision earned should be 25% of the total amount including brokered
   * deals." The same fee, treated oppositely in the two figures, and both
   * ways round are right: it has no cost, so it cannot be in a margin; it
   * is all profit, so it must be in a commission.
   */
  it('pays commission on brokered deals as well as watches', () => {
    expect(page).toContain('of everything you brought in')
  })

  it('keeps brokered deals out of the margin', () => {
    // The numerator is stock profit, which a fee never enters.
    expect(page).toContain('formatPct((totals.stockProfit / totals.cost) * 100)')
  })

  it('shows a salesperson no margin at all', () => {
    // "remove margin from Sales View" — both the card and the column.
    expect(page).toContain("{scope === 'all' && (\n          <StatCard\n            label=\"Weighted margin\"")
    expect(page).toContain('{scope === \'all\' && <TH width="90px" align="right">Margin</TH>}')
  })

  it('breaks the total down into the deals it is made of', () => {
    expect(page).toContain('Your deals')
    expect(page).toContain('<TH width="110px" align="right">Your share</TH>')
  })

  it('quotes no share on a buy-back, which the firm does not pay on', () => {
    expect(page).toContain("deal.kind === 'buyback'")
  })
})
