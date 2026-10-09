import { type NextRequest } from 'next/server'
import { isNull } from 'drizzle-orm'
import { getSessionUser } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { db } from '@/server/db/client'
import { locations } from '@/server/db/schema'
import { buildImportTemplate } from '@/server/services/import-template'
import { displayMoneyFor } from '@/server/services/display-currency'
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

  // The same currency the export uses for this person, so the template they
  // download and the file they export have identical headers.
  const { currency } = await displayMoneyFor(user.id)

  const workbook = await buildImportTemplate(names, currency)
  return new Response(new Uint8Array(workbook), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="osw-stock-template.xlsx"',
      'Content-Length': String(workbook.byteLength),
    },
  })
}
