import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { historyStatus, summariseHistory, type HistoryOrder } from '@/lib/order-history'

const order = (over: Partial<HistoryOrder>): HistoryOrder => ({
  id: Math.random().toString(36).slice(2),
  status: 'COMPLETED',
  watchStatus: 'SOLD',
  placedAt: '2026-10-01T10:00:00Z',
  completedAt: '2026-10-03T10:00:00Z',
  releasedAt: null,
  priceAtOrder: 95_000_00,
  askingAtOrder: 100_000_00,
  discountBpsAtOrder: 500,
  budgetApplied: null,
  ...over,
})

const NOW = new Date('2026-11-15T09:00:00Z')

describe('what an order counts as', () => {
  it('is a purchase once invoiced', () => {
    expect(historyStatus({ status: 'COMPLETED', watchStatus: 'SOLD' })).toBe('PURCHASED')
  })

  it('is on hold only while the watch agrees', () => {
    expect(historyStatus({ status: 'PLACED', watchStatus: 'RESERVED' })).toBe('ON_HOLD')
    // A hold that drifted — the watch moved on — is not money anybody owes.
    expect(historyStatus({ status: 'PLACED', watchStatus: 'IN_STOCK' })).toBe('RELEASED')
  })

  it('is released when let go', () => {
    expect(historyStatus({ status: 'RELEASED', watchStatus: 'IN_STOCK' })).toBe('RELEASED')
  })
})

describe('the spend summary', () => {
  const orders = [
    order({}),
    order({ priceAtOrder: 50_000_00, askingAtOrder: 52_000_00, completedAt: '2026-11-02T10:00:00Z', budgetApplied: 20_000_00 }),
    order({ status: 'PLACED', watchStatus: 'RESERVED', completedAt: null, priceAtOrder: 30_000_00 }),
    order({ status: 'RELEASED', watchStatus: 'IN_STOCK', completedAt: null, priceAtOrder: 80_000_00 }),
  ]
  const s = summariseHistory(orders, NOW)

  it('counts only purchases as spend', () => {
    expect(s.purchasedCount).toBe(2)
    expect(s.spent).toBe(145_000_00)
    expect(s.averageOrder).toBe(72_500_00)
  })

  it('keeps holds and releases out of the spend', () => {
    expect(s.onHoldCount).toBe(1)
    expect(s.onHold).toBe(30_000_00)
    expect(s.releasedCount).toBe(1)
  })

  it('works out what they saved against asking', () => {
    expect(s.saved).toBe(7_000_00)
  })

  it('records what campaign budgets covered', () => {
    expect(s.budgetCovered).toBe(20_000_00)
  })

  it('buckets spend by the month it was invoiced, over twelve months', () => {
    expect(s.months).toHaveLength(12)
    expect(s.months.at(-1)?.key).toBe('2026-11')
    expect(s.months.at(-1)?.spent).toBe(50_000_00)
    expect(s.months.at(-2)?.spent).toBe(95_000_00)
    expect(s.months[0].key).toBe('2025-12')
  })

  it('is all zeroes with nothing bought', () => {
    const empty = summariseHistory([], NOW)
    expect(empty.spent).toBe(0)
    expect(empty.averageOrder).toBe(0)
    expect(empty.lastPurchase).toBeNull()
  })
})

describe('where it is shown', () => {
  it('sits behind the portal passphrase', () => {
    const page = readFileSync('src/app/p/[token]/orders/page.tsx', 'utf8')
    expect(page).toContain('hasPortalPass')
  })

  it('is reachable from the stock page', () => {
    const room = readFileSync('src/components/portal/PortalRoom.tsx', 'utf8')
    expect(room).toContain('/orders')
  })

  it('totals every order, not a recent page of them', () => {
    const service = readFileSync('src/server/services/partner-order-service.ts', 'utf8')
    const fn = service.slice(service.indexOf('export async function listOrdersForPartner'))
    expect(fn.slice(0, fn.indexOf('\n}\n'))).not.toContain('.limit(')
  })
})
