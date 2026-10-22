import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { feeInBase } from '@/server/services/brokerage-service'
import { RATE_SCALE } from '@/lib/currency'

const read = (path: string) => readFileSync(path, 'utf8')

/**
 * A fee earned selling somebody else's watch. No stock, no cost, no margin —
 * which is the whole reason it could not be recorded as a sale.
 */

describe('converting the fee', () => {
  const rates = { USD: 9806, GBP: 21000 } as never

  it('leaves a fee already agreed in dirhams alone', () => {
    const { feeBase, feeFxRate } = feeInBase(500000, 'AED', rates)
    expect(feeBase).toBe(500000)
    expect(feeFxRate).toBe(RATE_SCALE)
  })

  it('converts a dollar fee to base minor units', () => {
    // $5,000.00 at the stored rate, the same arithmetic a sale uses.
    const { feeBase } = feeInBase(500000, 'USD', rates)
    expect(feeBase).toBe(Math.round((500000 * RATE_SCALE) / 9806))
  })

  it('falls back to parity rather than inventing a rate', () => {
    // An unknown currency must not silently scale the figure by zero or
    // explode — a fee that quietly becomes 0 is worse than one left as typed.
    const { feeBase } = feeInBase(500000, 'CHF' as never, {} as never)
    expect(feeBase).toBe(500000)
  })
})

describe('why it is not a sale', () => {
  const migration = read('src/server/db/migrations/0045_brokerage.sql')
  const schema = read('src/server/db/schema.ts')

  it('is its own table, leaving sales.watchId required', () => {
    // Seven queries inner-join sales to watches. A nullable watch_id would
    // drop these rows from the sales list, the customer history and the
    // reports, and the queries that did show them would average a sale
    // price and a margin over something that was never stock.
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS brokerages/)
    expect(schema).toMatch(/watchId: text\('watch_id'\)\.notNull\(\)/)
  })

  it('keeps the agreed figure as well as the base figure', () => {
    // The paperwork says $5,000; the reports add up dirhams. Losing either
    // makes one of those two conversations impossible.
    for (const column of ['fee_amount', 'fee_currency', 'fee_base', 'fee_fx_rate']) {
      expect(migration).toContain(column)
    }
  })

  it('voids rather than deletes, as a sale does', () => {
    expect(migration).toMatch(/voided_at/)
    expect(read('src/server/services/brokerage-service.ts')).toMatch(/export async function voidBrokerage/)
  })

  it('uses snake_case columns the mapper can actually find', () => {
    // Postgres folds unquoted identifiers to lowercase, so a soldFor column
    // becomes soldfor and the mapping silently misses it.
    expect(migration).not.toMatch(/\b(soldFor|soldTo|feeAmount|brokeredOn)\b/)
  })
})

describe('where the money lands', () => {
  const pnl = read('src/server/services/pnl-service.ts')
  const service = read('src/server/services/brokerage-service.ts')

  it('is income, added after gross profit rather than into it', () => {
    expect(pnl).toMatch(/trading\.grossProfit \+ brokered\.total - totalCosts/)
    // Not folded into the trading lines, which would inflate revenue and
    // margin on stock that never existed.
    expect(pnl).not.toMatch(/invoiced: trading\.invoiced \+/)
  })

  it('counts towards the salesperson, because the fee is the profit', () => {
    expect(service).toMatch(/export async function commissionBaseForMonth/)
    expect(service).toMatch(/paidProfit: Number\(row\.paidProfit\) \+ fees\.paidProfit/)
  })

  it('is read through one function everywhere, so the reports agree', () => {
    for (const path of [
      'src/server/services/pnl-service.ts',
      'src/app/(app)/reports/commission/page.tsx',
      'src/app/(app)/reports/costs/page.tsx',
    ]) {
      expect(read(path), path).toMatch(/commissionBaseForMonth/)
    }
  })

  it('separates settled from unsettled, as the sales ledger does', () => {
    expect(service).toMatch(/paymentStatus} = 'PAID'/)
    expect(service).toMatch(/paymentStatus} <> 'PAID'/)
  })

  it('excludes voided and deleted rows from every total', () => {
    expect(service).toMatch(/const live = \(\) => and\(isNull\(brokerages\.voidedAt\), isNull\(brokerages\.deletedAt\)\)/)
  })
})

describe('recording one', () => {
  const action = read('src/app/actions/watches.ts')
  const ledger = read('src/server/services/sales-ledger.ts')

  it('is behind sale:create, the same door as booking a sale', () => {
    expect(action).toMatch(/recordBrokerageAction/)
    expect(action).toMatch(/requireCapability\('sale:create'\)/)
  })

  it('lands in the sales ledger rather than a list of its own', () => {
    const page = read('src/app/(app)/sales/page.tsx')
    expect(page).toMatch(/findSalesLedger\(query\)/)
    expect(ledger).toMatch(/kind: 'COMMISSION'/)
  })

  it('is offered even before the first stock sale', () => {
    // A business that has not sold its own stock yet may still have
    // brokered a deal, and that is exactly when it needs somewhere to go.
    const page = read('src/app/(app)/sales/page.tsx')
    expect(page).toMatch(/<RecordCommission/)
    expect(page).toMatch(/Always offered, including on a first run/)
  })

  it('drops out of a view filtered to stock sales', () => {
    // Channel, a stock number, a supplier: a brokered deal has none of
    // them, so showing one in that view answers a different question.
    expect(ledger).toMatch(/const stockOnly = Boolean\(query\.channel\?\.length \|\| query\.q \|\| query\.f\?\.length\)/)
  })

  it('prints a dash for cost and margin rather than a zero', () => {
    // Margin on something with no cost is undefined, not 100%, and a zero
    // would be averaged into the weighted margin above the table.
    const table = read('src/components/sales/SalesTable.tsx')
    expect(table).toMatch(/sale\.kind === 'COMMISSION' \? '—' : money\(sale\.costGbp\)/)
    expect(table).toMatch(/sale\.kind === 'COMMISSION' \? '—' : formatPct/)
  })

  it('never fails silently on a rejected form', () => {
    // It did: it rejected on two fields the form does not render and the
    // panel printed nothing, so the button looked dead.
    const action = read('src/app/actions/watches.ts')
    expect(action).toMatch(/message: 'Check the highlighted fields and try again\.'/)
    const modal = read('src/components/sales/RecordCommission.tsx')
    expect(modal).toMatch(/useEffect\(\(\) => \{/)
    // Closing from the render body is a state update during render; React
    // refuses it and the panel sits open looking broken.
    expect(modal).not.toMatch(/if \(state\.ok && open\) \{/)
  })

  it('tolerates form fields that are absent entirely', () => {
    // formData.get() returns null, and optional() accepts undefined only.
    const validation = read('src/lib/validation.ts')
    expect(validation).toMatch(/customerId: z\.string\(\)\.trim\(\)\.nullish\(\)/)
    expect(validation).toMatch(/reference: z\.string\(\)\.trim\(\)\.max\(60\)\.nullish\(\)/)
  })
})

describe('a commission counts as a sale, and as profit', () => {
  const page = read('src/app/(app)/sales/page.tsx')

  it('is in the sales count', () => {
    expect(page).toMatch(/value=\{summary\.count \+ brokerTotals\.count\}/)
  })

  it('is in revenue', () => {
    expect(page).toMatch(/money\(summary\.revenueGbp \+ brokerTotals\.total\)/)
  })

  it('is in realised profit', () => {
    expect(page).toMatch(/formatBaseSigned\(summary\.profitGbp \+ brokerTotals\.total, currency, rates\)/)
  })

  it('is not in the weighted margin, and the caption says so', () => {
    // Margin is profit over cost. A fee has no cost under it, so it has no
    // margin — undefined rather than a hundred per cent — and folding it
    // in would replace the figure with one that cannot be compared to last
    // month's.
    expect(page).toMatch(/value=\{formatPct\(summary\.avgMarginBps \/ 100\)\}/)
    expect(page).toMatch(/'on stock sold'/)
  })

  it('leaves the header agreeing with the tiles', () => {
    // A header counting them apart from the rows they sit beside would be
    // describing a different table.
    expect(page).toMatch(/\$\{summary\.count \+ brokerTotals\.count\} \$\{summary\.count \+ brokerTotals\.count === 1 \? 'sale' : 'sales'\}/)
    expect(page).toMatch(/money\(summary\.revenueGbp \+ brokerTotals\.total\)\} revenue/)
  })
})
