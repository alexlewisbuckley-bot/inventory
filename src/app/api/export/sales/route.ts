import { type NextRequest } from 'next/server'
import { getSessionUser } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { findSales } from '@/server/repositories/sale-repository'
import { recordAudit } from '@/server/services/audit'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { toMajor } from '@/lib/money'

export const dynamic = 'force-dynamic'

const COLUMNS = [
  'Invoice', 'Sale Date', 'Stock No', 'Brand', 'Model', 'Supplier', 'Customer', 'Channel',
  'Cost (USD)', 'Sale (USD)', 'Sale (GBP)', 'Profit (USD)', 'Margin %',
] as const

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV export of the sales ledger, for the accountant. */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return new Response('Unauthorised', { status: 401 })
  if (!can(user.role, 'report:export')) return new Response('Forbidden', { status: 403 })
  rateLimit({ key: `export:${user.id}`, ...LIMITS.export })

  const params = request.nextUrl.searchParams
  const { items } = await findSales({
    q: params.get('q') ?? undefined,
    from: params.get('from') ? new Date(params.get('from')!) : undefined,
    to: params.get('to') ? new Date(params.get('to')!) : undefined,
    sort: 'saleDate',
    dir: 'asc',
    perPage: 200,
    page: 1,
  })

  const lines = [
    COLUMNS.join(','),
    ...items.map((s) => [
      s.invoiceNo, s.saleDate.toISOString().slice(0, 10), s.stockNo, s.brandName, s.model,
      s.supplierName, s.customerName, s.channel,
      s.costUsd !== null ? toMajor(s.costUsd).toFixed(2) : '',
      toMajor(s.amountUsd).toFixed(2), toMajor(s.amountGbp).toFixed(2),
      toMajor(s.profitUsd).toFixed(2), (s.marginBps / 100).toFixed(2),
    ].map(csvCell).join(',')),
  ]

  await recordAudit({
    entityType: 'Sale', entityId: 'bulk', action: 'EXPORT', actorId: user.id,
    summary: `${items.length} sales exported to CSV`,
  })

  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(`﻿${lines.join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bluecroft-sales-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
