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
    expect(page).toMatch(/roster\.filter\(\(person\) => !people\.some/)
    expect(page).toMatch(/No sales this period/)
  })

  it('tells a scoped reader nothing about anybody else', () => {
    // Who else exists is not a salesperson's business, so the roster is not
    // fetched, the idle list is empty, and the rows that leave the database
    // are only ever their own.
    expect(page).toMatch(/scope === 'all' \? listSalesPeople\(\) : Promise\.resolve\(\[\]\)/)
    expect(page).toMatch(/const idle = scope === 'all'/)
    const repo = read('src/server/repositories/sale-repository.ts')
    expect(repo).toMatch(/if \(onlyPersonId\) window\.push\(eq\(sales\.soldById, onlyPersonId\)\)/)
  })

  it('scopes at the query rather than filtering the answer', () => {
    // A filter applied after the fact leaves the other people's figures in
    // the payload, and the payload is the thing that leaks.
    expect(page).toMatch(/salesByPerson\(from, to, onlyMine\)/)
  })

  it('never lets a wide reader fall into the narrow view', () => {
    // Checking the narrow capability first would put an owner in the scoped
    // page — a silent failure that looks like working software. The helper
    // asks in the right order, once.
    expect(page).toMatch(/const scope = salesScope\(user\.role\)/)
    const perms = read('src/lib/permissions.ts')
    const fn = perms.slice(perms.indexOf('export function salesScope'))
    expect(fn.slice(0, 260)).toMatch(/report:read'\)\) return 'all'[\s\S]*report:own'\)\) return 'own'/)
  })

  it('asks an unlinked reader to be linked rather than showing an empty month', () => {
    expect(page).toMatch(/not linked to a salesperson yet/)
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

describe('managing who sells', () => {
  const manager = read('src/components/reference/SalesPeopleManager.tsx')
  const service = read('src/server/services/reference-service.ts')

  it('lets a seventh person be a row rather than a deploy', () => {
    expect(read('src/app/(app)/sales-people/page.tsx')).toMatch(/SalesPeopleManager/)
    expect(service).toMatch(/export async function saveSalesPerson/)
  })

  it('never deletes somebody who has been named on a sale', () => {
    // Deleting them would take the attribution off every sale they closed,
    // and a quarter that quietly loses its figures because a leaver was
    // tidied up is worse than a name in a list nobody uses. Deactivating
    // happens whatever was asked, so the safe outcome does not depend on
    // the caller choosing it.
    const fn = service.slice(service.indexOf('export async function deleteSalesPerson'))
    expect(fn.slice(0, 1400)).toMatch(/if \(sold\[0\]\) \{\n\s+await db\.update\(salesPeople\)\.set\(\{ isActive: false/)
  })

  it('says out loud when somebody cannot see their own figures', () => {
    // The consequence of an unlinked row is invisible otherwise.
    expect(manager).toMatch(/Not linked — cannot see their own sales/)
  })

  it('refuses to link one account to two people, and says which', () => {
    // A constraint violation surfacing as "duplicate key" is a dead end for
    // whoever is trying to do the linking.
    const fn = service.slice(service.indexOf('export async function saveSalesPerson'))
    expect(fn.slice(0, 1600)).toMatch(/already linked to \$\{taken\[0\]\.name\}/)
  })
})

describe('the way in', () => {
  it('exists for a reader who holds only the narrow capability', () => {
    // The Reports rail entry is behind `report:read`. Without its own entry
    // the scoped page exists and nothing points at it, which is the same as
    // it not existing.
    const nav = read('src/components/layout/nav-model.ts')
    expect(nav).toMatch(/salesScope\(role\) === 'own'/)
    expect(nav).toMatch(/label: 'My sales'/)
  })

  it('is not drawn twice for a reader who holds both', () => {
    // Every role above SALES holds `report:own` as well, so a capability
    // filter would put both entries in an owner's rail under two names.
    const nav = read('src/components/layout/nav-model.ts')
    const entry = nav.slice(nav.indexOf("label: 'My sales'") - 400, nav.indexOf("label: 'My sales'") + 120)
    expect(entry).not.toMatch(/capability: 'report:own'/)
  })

  it('offers a scoped reader no door they cannot open', () => {
    // /reports is behind `report:read`. A breadcrumb to it answers with a
    // refusal, and the tab row is one tab, which hides itself.
    expect(page).toMatch(/breadcrumbs=\{scope === 'own'\s*\n\s*\? undefined/)
    const tabs = read('src/components/reports/tabs.ts')
    expect(tabs).toMatch(/if \(scope === 'own'\) return \[\{ href: '\/reports\/people', label: 'My sales' \}\]/)
    expect(read('src/components/reports/ReportTabs.tsx')).toMatch(/if \(tabs\.length < 2\) return null/)
  })
})
