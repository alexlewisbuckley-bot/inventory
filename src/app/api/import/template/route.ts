import { type NextRequest } from 'next/server'
import { isNull } from 'drizzle-orm'
import { getSessionUser } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { db } from '@/server/db/client'
import { locations } from '@/server/db/schema'
import { buildImportTemplate } from '@/server/services/import-template'
import { templateCsv } from '@/lib/import-columns'
import type { Role } from '@/lib/enums'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The import template, generated rather than kept as a static file.
 *
 * It lists the locations that actually exist in this installation, so the one
 * column the importer cannot create for you comes with the valid answers
 * already written down.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user || !can(user.role as Role, 'watch:create')) {
    return new Response('Not permitted', { status: 403 })
  }

  const rows = await db.select({ name: locations.name }).from(locations).where(isNull(locations.deletedAt))
  const names = rows.map((row) => row.name)

  if (request.nextUrl.searchParams.get('format') === 'csv') {
    return new Response(templateCsv(), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="bluecroft-stock-template.csv"',
      },
    })
  }

  const workbook = await buildImportTemplate(names)
  return new Response(new Uint8Array(workbook), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="bluecroft-stock-template.xlsx"',
      'Content-Length': String(workbook.byteLength),
    },
  })
}
