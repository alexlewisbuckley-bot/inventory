import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The sales dashboard.
 *
 * The reports page carried a six-line summary that answered "who is ahead"
 * and nothing else. The questions that follow it — ahead by how much, on what
 * margin, against last month, and is anybody quietly not selling — each took
 * a query somebody ran by hand, so mostly nobody ran them.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const page = read('src/app/(app)/reports/people/page.tsx')

describe('what it ranks on', () => {
  it('is profit, not revenue', () => {
    // Revenue rewards whoever was handed the expensive watches. A leaderboard
    // on the wrong measure quietly teaches people to discount — and the test
    // data showed it: the person with the most revenue came third on profit.
    const repo = read('src/server/repositories/sale-repository.ts')
    const query = repo.slice(repo.indexOf('export async function salesByPerson'))
    expect(query.slice(0, 2000)).toMatch(/orderBy\(desc\(sql`coalesce\(sum\(\$\{sales\.profitGbp\}\), 0\)`\)\)/)
  })

  it('compares against a window of the same shape', () => {
    // A figure with nothing beside it says what happened but not whether it
    // is good — and comparing a part-finished month against a whole one is
    // worse than not comparing at all.
    expect(page).toMatch(/function windowFor/)
    expect(page).toMatch(/prevFrom/)
    expect(page).toMatch(/partial: true/)
    expect(page).toMatch(/This period is still running/)
  })
})

describe('the colours', () => {
  it('follow the person, never their rank', () => {
    // Narrowing the period reorders the chart. If colour came from position,
    // everybody would be repainted and last month's teal would be this
    // month's magenta.
    expect(page).toMatch(/roster\.map\(\(person, index\) => \[person\.id, \(\(index % 6\) \+ 1\)/)
  })

  it('never give the unattributed row somebody else’s hue', () => {
    // `Bar` defaults a missing slot to 1, so the sales nobody is recorded
    // against drew in the same navy as whoever held slot 1 and the two read
    // as the same person.
    expect(page).toMatch(/neutral: !person\.id/)
    const bar = read('src/components/charts/Bar.tsx')
    expect(bar).toMatch(/datum\.neutral \? 'bg-content-muted' : SLOT\[datum\.slot \?\? 1\]/)
  })

  it('keep the text in ink', () => {
    // A colour carries identity beside the name; it never becomes the name.
    expect(page).toMatch(/text-content-primary/)
    expect(page).not.toMatch(/text-chart-[1-6]/)
  })
})

describe('what it refuses to hide', () => {
  it('names the people who sold nothing', () => {
    // A leaderboard listing only the people who sold tells you who is ahead
    // and hides the thing a manager most needs to see.
    expect(page).toMatch(/const idle = roster\.filter/)
    expect(page).toMatch(/No sales this period/)
  })

  it('keeps the unattributed sales in the totals', () => {
    // Dropping them would make the dashboard disagree with the ledger with
    // nothing on screen to explain the gap.
    expect(page).toMatch(/these figures always add up to the ledger/)
  })

  it('carries a table view, like every chart in the product', () => {
    expect(page).toMatch(/<ChartFrame/)
    expect(page).toMatch(/table=\{\{/)
  })
})
