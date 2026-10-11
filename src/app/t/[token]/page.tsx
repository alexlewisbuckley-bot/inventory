import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTradeDoor, getTradeRoom } from '@/server/services/reseller-service'
import { hasTradePass } from '@/server/auth/trade-pass'
import { TradeGate } from '@/components/trade/TradeGate'
import { TradeRoom } from '@/components/trade/TradeRoom'

/**
 * Live, and never cached.
 *
 * A dealer list that is a few minutes stale is a dealer ringing about a watch
 * that went this morning, which is a worse conversation than having no list.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Says nothing, to anybody, ever.
 *
 * The shop window at least has a shop's name to put in a tab. This has a
 * passphrase on it, and a link that previews as "Trade stock · So-and-so" in
 * a forwarded message has told the forwarding half of the story to somebody
 * who was never given the other half.
 */
export const metadata: Metadata = {
  title: 'Trade access',
  robots: { index: false, follow: false, nocache: true },
}

export default async function TradePage({ params }: { params: { token: string } }) {
  const door = await getTradeDoor(params.token)
  // An unknown, closed or switched-off link is the same nothing as one that
  // never existed. Anything more specific tells whoever holds a dead link
  // that there is something real behind it.
  if (!door) notFound()

  const inside = await hasTradePass(params.token, door.passwordHash, door.passwordSetAt)
  if (!inside) {
    return (
      <TradeGate
        token={params.token}
        name={door.name}
        hasLogo={door.hasLogo}
        brandColor={door.brandColor}
        accentColor={door.accentColor}
      />
    )
  }

  // Loaded only once somebody is through the door: the gate must not cost a
  // catalogue query, and a wrong passphrase must not warm one either.
  const room = await getTradeRoom(params.token)
  if (!room) notFound()

  return (
    <TradeRoom
      token={params.token}
      reseller={room.reseller}
      items={room.items}
    />
  )
}
