import { type NextRequest } from 'next/server'
import { getSessionUser } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { findSales } from '@/server/repositories/sale-repository'
import { recordAudit } from '@/server/services/audit'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { displayMoneyFor } from '@/server/services/display-currency'
import { buildSalesWorkbook } from '@/server/services/stock-export'

export const dynamic = 'force-dynamic'

/**
 * The sales ledger as a spreadsheet, honouring the current filters.
 *
 * Money columns are named after the currency the reader works in and carry a
 * currency format, and the margin is a real number rather than the string
 * "12.34%" — a ledger gets sorted and totalled, and text does neither.
 */
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

  const stamp = new Date().toISOString().slice(0, 10)
  const workbook = await buildSalesWorkbook(items, display.currency, display.rates)

  await recordAudit({
    entityType: 'Sale', entityId: 'bulk', action: 'EXPORT', actorId: user.id,
    summary: `${items.length} sales exported`,
  })

  return new Response(new Uint8Array(workbook), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="osw-sales-${stamp}.xlsx"`,
      'Content-Length': String(workbook.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}
