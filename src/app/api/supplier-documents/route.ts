import { NextResponse, type NextRequest } from 'next/server'
import { requireCapability } from '@/server/auth/session'
import {
  addSupplierDocument, deleteSupplierDocument, MAX_ID_BYTES,
} from '@/server/services/compliance-service'
import { rateLimit } from '@/server/auth/rate-limit'
import { isAppError } from '@/lib/errors'
import { ID_DOCUMENT_KINDS, type IdDocumentKind } from '@/lib/enums'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/**
 * Attach an identity document to a supplier.
 *
 * A route handler rather than a server action: server actions serialise their
 * payload as JSON, which would base64 the bytes and inflate a passport
 * photograph by a third for no reason.
 *
 * `supplier:manage`, not `supplier:read`. Everyone who can see the supplier
 * book can see who you buy from; far fewer people should be able to put a
 * passport into it.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireCapability('supplier:manage')
    rateLimit({ key: `supplier-doc:${actor.id}`, limit: 30, windowMs: 60_000 })

    const form = await request.formData()
    const file = form.get('file')
    const supplierId = String(form.get('supplierId') ?? '')
    const rawKind = String(form.get('kind') ?? 'PASSPORT')
    const kind: IdDocumentKind = (ID_DOCUMENT_KINDS as readonly string[]).includes(rawKind)
      ? (rawKind as IdDocumentKind)
      : 'PASSPORT'

    if (!supplierId) return NextResponse.json({ error: 'No supplier specified.' }, { status: 400 })
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'No file received.' }, { status: 400 })
    }
    if (file.size > MAX_ID_BYTES) {
      return NextResponse.json({ error: 'That file is over 8 MB.' }, { status: 413 })
    }

    const expiresOn = String(form.get('expiresOn') ?? '').trim()

    const id = await addSupplierDocument({
      supplierId,
      kind,
      holderName: String(form.get('holderName') ?? '') || null,
      // A date input sends '' when left blank, and '' is not a date.
      expiresOn: /^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ? expiresOn : null,
      fileName: file.name || 'identity-document',
      mimeType: file.type || 'application/octet-stream',
      buffer: await file.arrayBuffer(),
    }, actor)

    return NextResponse.json({ id })
  } catch (error) {
    if (isAppError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error('supplier document upload failed', { error: (error as Error).message })
    return NextResponse.json({ error: 'Could not save that document.' }, { status: 500 })
  }
}

/** Remove a document. Soft — see the service. */
export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireCapability('supplier:manage')
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'No document specified.' }, { status: 400 })
    await deleteSupplierDocument(id, actor)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (isAppError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error('supplier document delete failed', { error: (error as Error).message })
    return NextResponse.json({ error: 'Could not remove that document.' }, { status: 500 })
  }
}
