import { type NextRequest } from 'next/server'
import { getSessionUser } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { findSales } from '@/server/repositories/sale-repository'
import { recordAudit } from '@/server/services/audit'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { toCsv } from '@/lib/csv'
import { formatBase } from '@/lib/currency'
import { displayMoneyFor } from '@/server/services/display-currency'
import type { CurrencyCode } from '@/lib/enums'

export const dynamic = 'force-dynamic'

/**
 * Named after the currency the reader works in, and written as currency.
 *
 * The money columns were headed "(GBP)" and filled with bare decimals, which
 * is two problems at once: the figures are shown in dollars everywhere else in
 * the product, and a column of unlabelled numbers is the kind of thing
 * somebody reconciles against and gets wrong.
 */
const columnsFor = (currency: CurrencyCode) => [
  'Invoice', 'Sale Date', 'Stock No', 'Brand', 'Reference', 'Supplier', 'Customer', 'Channel',
  `Cost (${currency})`, `Sale (${currency})`, `Profit (${currency})`, 'Margin %',
] as const

/** CSV export of the sales ledger, honouring the current filters. */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return new Response('Unauthorised', { status: 401 })
  if (!can(user.role, 'report:export')) return new Response('Forbidden', { status: 403 })
  rateLimit({ key: `export:${user.id}`, ...LIMITS.export })

  // Paged to the end: a CSV that stops at 200 rows looks complete.
  const PAGE_SIZE = 200
  const MAX_ROWS = 20_000

  const params = request.nextUrl.searchParams
  const filters = {
    q: params.get('q') ?? undefined,
    from: params.get('from') ? new Date(params.get('from')!) : undefined,
    to: params.get('to') ? new Date(params.get('to')!) : undefined,
    sort: 'saleDate' as const,
    dir: 'asc' as const,
    perPage: PAGE_SIZE,
  }

  let items: Awaited<ReturnType<typeof findSales>>['items'] = []
  for (let page = 1; items.length < MAX_ROWS; page += 1) {
    const result = await findSales({ ...filters, page })
    items = items.concat(result.items)
    if (page >= result.pages || result.items.length === 0) break
  }

  // Converted for whoever is downloading it, the same way the screens convert
  // for whoever is reading them.
  const display = await displayMoneyFor(user.id)
  const money = (base: number | null) =>
    base === null ? '' : formatBase(base, display.currency, display.rates, { decimals: true })

  const csv = toCsv(columnsFor(display.currency), items.map((s) => [
    s.invoiceNo, s.saleDate.toISOString().slice(0, 10), s.stockNo, s.brandName, s.model,
    s.supplierName, s.customerName, s.channel,
    money(s.costGbp),
    money(s.amountGbp),
    money(s.profitGbp),
    `${(s.marginBps / 100).toFixed(2)}%`,
  ]))

  await recordAudit({
    entityType: 'Sale', entityId: 'bulk', action: 'EXPORT', actorId: user.id,
    summary: `${items.length} sales exported to CSV`,
  })

  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bluecroft-sales-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
