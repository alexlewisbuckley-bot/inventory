import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const service = readFileSync(join(process.cwd(), 'src/server/services/brokerage-service.ts'), 'utf8')

/** The comparator the service settles the leaderboard on. */
const byProfit = (a: Row, b: Row) => b.profitGbp - a.profitGbp || a.personName.localeCompare(b.personName)
type Row = { personName: string; profitGbp: number }

/**
 * The order a leaderboard is read in.
 *
 * Alex: "These should be in order of profit." They were — by the profit the
 * database could see, which is the stock alone. Brokered fees and buy-back
 * charges are folded in afterwards, in JavaScript, and nothing sorted the
 * list again, so a person was ranked on whichever part of their month
 * happened to be a watch.
 */
describe('Sales by person, in order of profit', () => {
  // The page as it stood, with the real figures from it. The first four are
  // the database's order (stock profit, descending); Gabriella's month was
  // entirely brokered, so her row is appended by the fold-in loop.
  const asBuilt: Row[] = [
    { personName: 'Edward', profitGbp: 88_458 },
    { personName: 'Alex', profitGbp: 42_519 },
    { personName: 'Francesca', profitGbp: 6_050 },
    { personName: 'Zoe', profitGbp: 19_690 },   // 4,982 of stock, 14,708 of fee
    { personName: 'Gabriella', profitGbp: 33_052 }, // all fee, so appended last
  ]

  it('put two people in the wrong places before the fix', () => {
    expect(asBuilt.map((r) => r.personName)).toEqual(
      ['Edward', 'Alex', 'Francesca', 'Zoe', 'Gabriella'],
    )
    // Zoe earned more than Francesca and was ranked below her.
    expect(asBuilt[2]!.profitGbp).toBeLessThan(asBuilt[3]!.profitGbp)
  })

  it('ranks on the figure the page prints', () => {
    expect([...asBuilt].sort(byProfit).map((r) => r.personName)).toEqual(
      ['Edward', 'Alex', 'Gabriella', 'Zoe', 'Francesca'],
    )
  })

  it('puts a month that was entirely brokered in its rightful place', () => {
    // Gabriella has no stock profit at all, so the database cannot rank her.
    const sorted = [...asBuilt].sort(byProfit)
    expect(sorted.findIndex((r) => r.personName === 'Gabriella')).toBe(2)
  })

  it('settles a tie by name so the order does not shuffle', () => {
    const level: Row[] = [
      { personName: 'Zoe', profitGbp: 5_000 },
      { personName: 'Alex', profitGbp: 5_000 },
    ]
    expect([...level].sort(byProfit).map((r) => r.personName)).toEqual(['Alex', 'Zoe'])
    expect([...level].reverse().sort(byProfit).map((r) => r.personName)).toEqual(['Alex', 'Zoe'])
  })

  it('keeps a loss below everybody who made money', () => {
    const withLoss: Row[] = [
      { personName: 'Zoe', profitGbp: -2_000 },
      { personName: 'Alex', profitGbp: 0 },
      { personName: 'Edward', profitGbp: 1 },
    ]
    expect([...withLoss].sort(byProfit).map((r) => r.personName)).toEqual(['Edward', 'Alex', 'Zoe'])
  })

  it('sorts in the service, after the fees are in', () => {
    // Not in the SQL, which can only see the stock, and not in the page,
    // which would leave the chart and the table free to disagree.
    expect(service).toContain(
      'return rows.sort((a, b) => b.profitGbp - a.profitGbp || a.personName.localeCompare(b.personName))',
    )
  })
})
