import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPortalDoor, getPortalRoom } from '@/server/services/partner-portal-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import { PortalGate } from '@/components/portal/PortalGate'
import { PortalRoom } from '@/components/portal/PortalRoom'

/**
 * Live, and never cached.
 *
 * A list that is a few minutes stale is a partner reserving a watch that went
 * this morning, which is a worse conversation than having no list.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Says nothing, to anybody, ever.
 *
 * This has a passphrase on it, and a link that previews as "Partner stock ·
 * So-and-so" in a forwarded message has told the forwarding half of the story
 * to somebody who was never given the other half.
 */
export const metadata: Metadata = {
  title: 'Partner access',
  robots: { index: false, follow: false, nocache: true },
}

export default async function PortalPage({ params }: { params: { token: string } }) {
  const door = await getPortalDoor(params.token)
  // An unknown, closed or switched-off link is the same nothing as one that
  // never existed. Anything more specific tells whoever holds a dead link
  // that there is something real behind it.
  if (!door) notFound()

  const inside = await hasPortalPass(params.token, door.passwordHash, door.passwordSetAt)
  if (!inside) {
    return (
      <PortalGate
        token={params.token}
        name={door.name}
        hasLogo={door.hasLogo}
        brandColor={door.brandColor}
        accentColor={door.accentColor}
      />
    )
  }

  // Loaded only once somebody is through the door: the gate must not cost a
  // stock query, and a wrong passphrase must not warm one either.
  const room = await getPortalRoom(params.token)
  if (!room) notFound()

  return (
    <PortalRoom
      token={params.token}
      partner={room.partner}
      items={room.items}
      orders={room.orders}
    />
  )
}
