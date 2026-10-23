import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/app/actions/watches.ts', 'utf8')

/**
 * A sale that does not reach the reports.
 *
 * Recording a sale used to refresh the stock list, the dashboard and the
 * ledger and stop there. Every report went on showing the figures from
 * before it — the overview's lifetime totals, the leaderboard, the
 * commission run, the profit and loss — which read as the numbers being
 * wrong rather than stale, and looked intermittent because the pages are
 * `force-dynamic`: the server would render the new figures, and the
 * client's router cache served the old payload until it expired.
 *
 * These tests pin the one helper and the list of screens it refreshes, so
 * the next report added to the app is wired in once instead of being
 * discovered missing a month later.
 */
describe('a transacted sale reaches every screen that reads it', () => {
  /** Each page whose figures change the moment a sale is booked. */
  const dependents = [
    '/sales',
    '/today',
    '/insights',
    '/reports',
    '/reports/people',
    '/reports/pnl',
    '/reports/commission',
    '/reports/costs',
    '/reports/ageing',
  ]

  const body = source.slice(
    source.indexOf('function refreshLedger'),
    source.indexOf('async function mirror'),
  )

  it.each(dependents)('refreshes %s', (path) => {
    expect(body).toContain(`revalidatePath('${path}')`)
  })

  it('refreshes the stock screens too, since the watch has left the shelf', () => {
    expect(body).toContain('refreshInventory()')
  })

  /**
   * Named one at a time rather than by scanning for exports: the point is
   * that *these* verbs move the ledger, and a new one is a deliberate
   * addition here rather than something a regex quietly absorbs.
   */
  const movers = [
    'recordSaleAction',
    'voidSaleAction',
    'amendSaleAction',
    'markSalePaidAction',
    'recordBrokerageAction',
    'voidBrokerageAction',
    'saleToCommissionAction',
    'linkCommissionWatchAction',
  ]

  it.each(movers)('%s uses it', (action) => {
    const start = source.indexOf(`export async function ${action}`)
    expect(start, `${action} not found`).toBeGreaterThan(-1)
    const next = source.indexOf('\nexport async function', start + 1)
    const fn = source.slice(start, next === -1 ? undefined : next)
    expect(fn).toContain('refreshLedger()')
  })

  it('leaves no sale mutation refreshing the ledger by hand', () => {
    // A stray revalidatePath('/sales') outside the helper is the exact
    // shape of the original bug: one screen remembered, the rest not.
    const elsewhere = source.replace(body, '')
    expect(elsewhere).not.toContain("revalidatePath('/sales')")
  })
})
