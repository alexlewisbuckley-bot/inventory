import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPortalDoor } from '@/server/services/partner-portal-service'
import { listOrdersForPartner } from '@/server/services/partner-order-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import { PortalGate } from '@/components/portal/PortalGate'
import { OrderHistory } from '@/components/portal/OrderHistory'
import { PartnerMark, PortalHeader } from '@/components/portal/PortalHeader'
import { PortalNav } from '@/components/portal/PortalNav'
import { brandVars, ui } from '@/components/portal/ui'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata: Metadata = {
  title: 'Orders',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * A partner's own purchase and spend history.
 *
 * Behind the same door as the stock list: what a company has spent with us
 * is theirs to see and nobody else's.
 */
export default async function PortalOrdersPage({ params }: { params: { token: string } }) {
  const door = await getPortalDoor(params.token)
  if (!door) notFound()

  if (!await hasPortalPass(params.token, door.passwordHash, door.passwordSetAt)) {
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

  const orders = await listOrdersForPartner(door.id)

  return (
    <main
      className="min-h-screen bg-white"
      style={brandVars(door.brandColor, door.accentColor)}
    >
      <PortalHeader
        wide
        brand={<PartnerMark token={params.token} name={door.name} hasLogo={door.hasLogo} />}
        eyebrow="Purchase history"
        subtitle="Everything you have reserved or bought, and what it has come to."
        actions={<PortalNav token={params.token} active="orders" />}
      />

      <div className={ui.page}>
        {/* No stock numbers: they are our filing, not something a partner
            needs or should be quoting back at us. */}
        <OrderHistory
          orders={orders.map(({ stockNo: _stockNo, ...order }) => ({
            ...order,
            placedAt: order.placedAt.toISOString(),
            completedAt: order.completedAt?.toISOString() ?? null,
            releasedAt: order.releasedAt?.toISOString() ?? null,
          }))}
        />
      </div>
    </main>
  )
}
