import { type NextRequest } from 'next/server'
import { requireCapability } from '@/server/auth/session'
import { getLibraryBytes } from '@/server/services/image-service'

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
