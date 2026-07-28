import { NextResponse, type NextRequest } from 'next/server'
import { requireCapability } from '@/server/auth/session'
import { addImage } from '@/server/services/image-service'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { isAppError } from '@/lib/errors'
import { IMAGE_KINDS, type ImageKind } from '@/lib/enums'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/**
 * Accept an image upload.
 *
 * A route handler rather than a server action: server actions serialise their
 * payload as JSON, which would base64 the bytes and inflate them by a third.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireCapability('watch:update')
    rateLimit({ key: `upload:${actor.id}`, limit: 60, windowMs: 60_000 })

    const form = await request.formData()
    const file = form.get('file')
    const watchId = String(form.get('watchId') ?? '')
    const rawKind = String(form.get('kind') ?? 'WATCH')
    const kind: ImageKind = (IMAGE_KINDS as readonly string[]).includes(rawKind)
      ? (rawKind as ImageKind)
      : 'WATCH'

    if (!watchId) return NextResponse.json({ error: 'No watch specified.' }, { status: 400 })
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file received.' }, { status: 400 })

    const image = await addImage({
      watchId,
      kind,
      mimeType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
      width: Number(form.get('width')) || undefined,
      height: Number(form.get('height')) || undefined,
    }, actor)

    return NextResponse.json({ image })
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error('image upload failed', { error: (error as Error).message })
    return NextResponse.json({ error: 'Could not save that image.' }, { status: 500 })
  }
}

/** Remove an image. */
export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireCapability('watch:update')
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'No image specified.' }, { status: 400 })
    const { deleteImage } = await import('@/server/services/image-service')
    await deleteImage(id, actor)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (isAppError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'Could not remove that image.' }, { status: 500 })
  }
}
