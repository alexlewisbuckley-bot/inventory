import { type NextRequest } from 'next/server'
import { agentLogo } from '@/server/services/partner-programme-stock'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const logo = await agentLogo(params.token)
  if (!logo) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(logo.data), {
    headers: {
      'Content-Type': logo.mimeType,
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
