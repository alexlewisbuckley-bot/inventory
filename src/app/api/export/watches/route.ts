import { type NextRequest } from 'next/server'
import { inArray } from 'drizzle-orm'
import { getSessionUser } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { findWatches } from '@/server/repositories/watch-repository'
import { watchQuerySchema } from '@/lib/validation'
import { recordAudit } from '@/server/services/audit'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { toMajor } from '@/lib/money'
import { db } from '@/server/db/client'
import { watches } from '@/server/db/schema'

export const dynamic = 'force-dynamic'

const COLUMNS = [
  'Stock No', 'Brand', 'Model', 'Nickname', 'Serial', 'Supplier', 'Location',
  'Purchase Date', 'Purchase Price (GBP)', 'Purchase Price (USD)',
  'Est Sale (USD)', 'Est Profit (USD)', 'Status',
] as const

/** RFC 4180 escaping — quote when the value contains a delimiter or quote. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * CSV export of the current view.
 *
 * Accepts the same query parameters as the inventory list so "export what I am
 * looking at" is exact, plus repeated `id` params for an explicit selection.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return new Response('Unauthorised', { status: 401 })
  if (!can(user.role, 'report:export')) return new Response('Forbidden', { status: 403 })

  rateLimit({ key: `export:${user.id}`, ...LIMITS.export })

  const params = request.nextUrl.searchParams
  const ids = params.getAll('id')

  let rows
  if (ids.length > 0) {
    const selected = await db.select({ id: watches.id }).from(watches).where(inArray(watches.id, ids))
    const query = watchQuerySchema.parse({ perPage: 200, page: 1 })
    const all = await findWatches({ ...query, perPage: 200 })
    const allowed = new Set(selected.map((s) => s.id))
    rows = all.items.filter((item) => allowed.has(item.id))
  } else {
    const query = watchQuerySchema.parse({
      q: params.get('q') ?? undefined,
      status: params.getAll('status').length ? params.getAll('status') : undefined,
      locationId: params.getAll('locationId').length ? params.getAll('locationId') : undefined,
      supplierId: params.getAll('supplierId').length ? params.getAll('supplierId') : undefined,
      unpricedOnly: params.get('unpricedOnly') ?? undefined,
      sort: params.get('sort') ?? 'stockNo',
      dir: params.get('dir') ?? 'asc',
      perPage: 200,
      page: 1,
    })
    rows = (await findWatches(query)).items
  }

  const lines = [
    COLUMNS.join(','),
    ...rows.map((w) => [
      w.stockNo, w.brandName, w.model, w.nickname, w.serial, w.supplierName, w.locationName,
      w.purchaseDate.toISOString().slice(0, 10),
      toMajor(w.purchasePriceGbp).toFixed(2),
      w.purchasePriceUsd !== null ? toMajor(w.purchasePriceUsd).toFixed(2) : '',
      w.estSaleUsd !== null ? toMajor(w.estSaleUsd).toFixed(2) : '',
      w.estProfitUsd !== null ? toMajor(w.estProfitUsd).toFixed(2) : '',
      w.status,
    ].map(csvCell).join(',')),
  ]

  await recordAudit({
    entityType: 'Watch', entityId: 'bulk', action: 'EXPORT', actorId: user.id,
    summary: `${rows.length} watches exported to CSV`,
  })

  const stamp = new Date().toISOString().slice(0, 10)
  // BOM keeps Excel from mangling the £ sign on Windows.
  return new Response(`﻿${lines.join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bluecroft-stock-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
