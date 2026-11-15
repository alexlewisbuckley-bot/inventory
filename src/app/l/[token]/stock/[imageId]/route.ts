import { type NextRequest } from 'next/server'
import { getPrizeImage } from '@/server/services/leaderboard-service'

export const dynamic = 'force-dynamic'

/** A website photograph of a watch, for the prize picker and the prize cards. */
export async function GET(_request: NextRequest, { params }: { params: { token: string; imageId: string } }) {
  const image = await getPrizeImage(params.token, params.imageId)
  if (!image) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.mimeType,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
