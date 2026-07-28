import { type NextRequest } from 'next/server'
import { getSessionUser } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { findSales } from '@/server/repositories/sale-repository'
import { recordAudit } from '@/server/services/audit'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { toMajor } from '@/lib/money'
import { toCsv } from '@/lib/csv'

export const dynamic = 'force-dynamic'

// GBP is the reporting base, so the export leads with it. USD is retained
// because historic exports were denominated that way and downstream
// spreadsheets still reconcile against the column.
const COLUMNS = [
  'Invoice', 'Sale Date', 'Stock No', 'Brand', 'Reference', 'Supplier', 'Customer', 'Channel',
  'Cost (GBP)', 'Sale (GBP)', 'Profit (GBP)', 'Margin %', 'Sale (USD)',
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

  const csv = toCsv(COLUMNS, items.map((s) => [
    s.invoiceNo, s.saleDate.toISOString().slice(0, 10), s.stockNo, s.brandName, s.model,
    s.supplierName, s.customerName, s.channel,
    toMajor(s.costGbp).toFixed(2),
    toMajor(s.amountGbp).toFixed(2),
    toMajor(s.profitGbp).toFixed(2),
    (s.marginBps / 100).toFixed(2),
    toMajor(s.amountUsd).toFixed(2),
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
