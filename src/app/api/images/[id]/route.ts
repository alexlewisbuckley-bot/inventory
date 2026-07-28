import { type NextRequest } from 'next/server'
import { getSessionUser } from '@/server/auth/session'
import { getImageBytes } from '@/server/services/image-service'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/**
 * Serve an image.
 *
 * Behind the session check — stock photographs are commercially sensitive, so
 * they are not public URLs. Cached privately and immutably: the id is unique
 * per upload and bytes never change, so a long TTL is safe and keeps the
 * database out of the path on repeat views.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser()
  if (!user) return new Response('Unauthorised', { status: 401 })
  if (!can(user.role, 'watch:read')) return new Response('Forbidden', { status: 403 })

  const image = await getImageBytes(params.id)
  if (!image) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.mimeType,
      'Content-Length': String(image.byteSize),
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
