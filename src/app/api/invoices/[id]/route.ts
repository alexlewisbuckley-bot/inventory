import { type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { getSessionUser } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { db } from '@/server/db/client'
import { purchaseInvoices } from '@/server/db/schema'

export const dynamic = 'force-dynamic'

/**
 * Serve the supplier invoice a watch was booked in from.
 *
 * The document has been stored since intake; there was simply no way to open
 * it, which made "the invoice is kept" a claim nobody could check. An invoice
 * you cannot produce on request is an invoice you do not have.
 *
 * Behind the session check like the stock photographs: purchase prices and
 * supplier terms are commercially sensitive and these are not public URLs.
 * Served inline so it opens in the browser rather than landing in Downloads.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser()
  if (!user) return new Response('Unauthorised', { status: 401 })
  if (!can(user.role, 'watch:read')) return new Response('Forbidden', { status: 403 })

  const rows = await db
    .select({
      data: purchaseInvoices.data,
      mimeType: purchaseInvoices.mimeType,
      byteSize: purchaseInvoices.byteSize,
      fileName: purchaseInvoices.fileName,
      deletedAt: purchaseInvoices.deletedAt,
    })
    .from(purchaseInvoices)
    .where(eq(purchaseInvoices.id, params.id))
    .limit(1)

  const invoice = rows[0]
  if (!invoice || invoice.deletedAt) return new Response('Not found', { status: 404 })

  // The stored name can carry anything the uploader's filesystem allowed;
  // quotes and newlines in a Content-Disposition header are how a filename
  // becomes a header injection.
  const safeName = invoice.fileName.replace(/[^\w. -]+/g, '_').slice(0, 120) || 'invoice.pdf'

  return new Response(new Uint8Array(invoice.data), {
    headers: {
      'Content-Type': invoice.mimeType,
      'Content-Length': String(invoice.byteSize),
      'Content-Disposition': `inline; filename="${safeName}"`,
      // The bytes never change once stored, and the id is unique per upload.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
