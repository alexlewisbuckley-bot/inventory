import { type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { getSessionUser } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { db } from '@/server/db/client'
import { supplierDocuments } from '@/server/db/schema'
import { recordAudit } from '@/server/services/audit'

export const dynamic = 'force-dynamic'

/**
 * Serve one identity document.
 *
 * The most sensitive bytes in the system, and treated accordingly:
 *
 *  - The capability follows the subject: `supplier:manage` for a director's
 *    passport, `customer:update` for a buyer's. Everybody who can see the
 *    supplier book can see who you buy from; far fewer people should be able
 *    to open a passport.
 *  - Every read is written to the audit trail. For ordinary documents that
 *    would be noise; for identity evidence, who looked and when is exactly the
 *    question an audit asks, and it cannot be answered retrospectively.
 *  - `no-store`, unlike the invoice route's immutable year. A passport scan
 *    should not sit in a shared machine's disk cache after the session that
 *    opened it has ended.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser()
  if (!user) return new Response('Unauthorised', { status: 401 })

  const rows = await db
    .select({
      data: supplierDocuments.data,
      mimeType: supplierDocuments.mimeType,
      byteSize: supplierDocuments.byteSize,
      fileName: supplierDocuments.fileName,
      supplierId: supplierDocuments.supplierId,
      customerId: supplierDocuments.customerId,
      deletedAt: supplierDocuments.deletedAt,
    })
    .from(supplierDocuments)
    .where(eq(supplierDocuments.id, params.id))
    .limit(1)

  const document = rows[0]
  if (!document || document.deletedAt) return new Response('Not found', { status: 404 })

  // Checked after the lookup rather than before, because which door this is
  // depends on whose document it turns out to be.
  const needed = document.supplierId ? 'supplier:manage' : 'customer:update'
  if (!can(user.role, needed)) return new Response('Forbidden', { status: 403 })

  await recordAudit({
    entityType: document.supplierId ? 'Supplier' : 'Customer',
    entityId: (document.supplierId ?? document.customerId)!,
    action: 'EXPORT',
    actorId: user.id,
    summary: `Identity document ${document.fileName} opened`,
  })

  // The stored name can carry whatever the uploader's filesystem allowed;
  // quotes and newlines in a Content-Disposition header are how a filename
  // becomes a header injection.
  const safeName = document.fileName.replace(/[^\w. -]+/g, '_').slice(0, 120) || 'document'

  return new Response(new Uint8Array(document.data), {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Length': String(document.byteSize),
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
