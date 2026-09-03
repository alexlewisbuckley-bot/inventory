import { type NextRequest } from 'next/server'
import { inArray } from 'drizzle-orm'
import { getSessionUser } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { findWatches } from '@/server/repositories/watch-repository'
import { watchQuerySchema } from '@/lib/validation'
import { parseFilters, WATCH_FIELDS } from '@/lib/filters'
import { recordAudit } from '@/server/services/audit'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { toMajor } from '@/lib/money'
import { toCsv } from '@/lib/csv'
import { PRODUCT_TYPE_LABELS } from '@/lib/enums'
import { db } from '@/server/db/client'
import { watches } from '@/server/db/schema'

export const dynamic = 'force-dynamic'

/**
 * Column names and order match the import template exactly, so a file exported
 * here can be edited and imported straight back — which is the only reason to
 * offer both. Everything is in the GBP base the rest of the system reports in.
 */
const COLUMNS = [
  'Stock No', 'Type', 'Brand', 'Reference', 'Serial', 'Supplier', 'Location',
  'Purchase Date', 'Purchase Price (GBP)', 'Est Sale (GBP)', 'Est Profit (GBP)',
  'Status',
] as const

/**
 * CSV export of the current view.
 *
 * Accepts the same query parameters as the inventory list, so "export what I
 * am looking at" is exact, plus repeated `id` params for an explicit selection.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return new Response('Unauthorised', { status: 401 })
  if (!can(user.role, 'report:export')) return new Response('Forbidden', { status: 403 })

  rateLimit({ key: `export:${user.id}`, ...LIMITS.export })

  const params = request.nextUrl.searchParams
  const ids = params.getAll('id')

  // An export that quietly stops at the first page is worse than no export:
  // the file looks complete and the missing stock is invisible. Paged through
  // to the end, with a ceiling that exists only so a runaway query cannot hold
  // the process open.
  const PAGE_SIZE = 200
  const MAX_ROWS = 20_000

  const query = watchQuerySchema.parse({
    q: params.get('q') ?? undefined,
    status: params.getAll('status').length ? params.getAll('status') : undefined,
    locationId: params.getAll('locationId').length ? params.getAll('locationId') : undefined,
    supplierId: params.getAll('supplierId').length ? params.getAll('supplierId') : undefined,
    unpricedOnly: params.get('unpricedOnly') ?? undefined,
    sort: params.get('sort') ?? 'stockNo',
    dir: params.get('dir') ?? 'asc',
    perPage: PAGE_SIZE,
    page: 1,
    // The V2 filter grammar, which is what the view chips and the filter bar
    // now write. Without this the route accepted only the older named
    // parameters, so exporting from "Sold" — a view expressed entirely as
    // `f=` — silently handed back the whole book instead.
    f: parseFilters(params, WATCH_FIELDS),
  })

  let rows: Awaited<ReturnType<typeof findWatches>>['items'] = []
  for (let page = 1; rows.length < MAX_ROWS; page += 1) {
    const result = await findWatches({ ...query, page })
    rows = rows.concat(result.items)
    if (page >= result.pages || result.items.length === 0) break
  }
  if (ids.length > 0) {
    const selected = await db.select({ id: watches.id }).from(watches).where(inArray(watches.id, ids))
    const allowed = new Set(selected.map((row) => row.id))
    rows = rows.filter((row) => allowed.has(row.id))
  }

  const csv = toCsv(COLUMNS, rows.map((w) => [
    w.stockNo, PRODUCT_TYPE_LABELS[w.productType], w.brandName, w.model, w.serial,
    w.supplierName, w.locationName,
    w.purchaseDate.toISOString().slice(0, 10),
    toMajor(w.purchasePriceGbp).toFixed(2),
    w.estSaleGbp !== null ? toMajor(w.estSaleGbp).toFixed(2) : '',
    w.estSaleGbp !== null ? toMajor(w.estSaleGbp - w.purchasePriceGbp).toFixed(2) : '',
    w.status,
  ]))

  await recordAudit({
    entityType: 'Watch', entityId: 'bulk', action: 'EXPORT', actorId: user.id,
    summary: `${rows.length} watches exported to CSV`,
  })

  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bluecroft-stock-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
