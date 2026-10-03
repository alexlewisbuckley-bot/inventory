import { NextResponse, type NextRequest } from 'next/server'
import { requireCapability } from '@/server/auth/session'
import { getLibraryBytes, removeLibraryImage } from '@/server/services/image-service'

export const dynamic = 'force-dynamic'

/**
 * Serve a photograph from the reference library.
 *
 * Separate from `/api/images/[id]` because these are not a watch's
 * photographs: nothing has chosen one for a watch yet, so the catalogue door
 * does not open them. Only somebody who could attach one can look at them.
 *
 * Cached privately and immutably — the id is unique per banked picture and
 * the bytes never change.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  await requireCapability('watch:update')

  const image = await getLibraryBytes(params.id)
  if (!image) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.mimeType,
      'Content-Length': String(image.byteSize),
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}

/**
 * Take a photograph off the shelf.
 *
 * The library is shared by every watch of a reference, so this is a wider
 * action than deleting a watch's own picture — a batch shot on a white
 * background that has been replaced by cut-outs should stop being offered to
 * the next watch, and this is how. Copies already taken by a watch are its
 * own and are left exactly where they are.
 */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireCapability('watch:update')
  try {
    await removeLibraryImage(params.id, actor)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Could not remove that photograph.' }, { status: 400 })
  }
}
