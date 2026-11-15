import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPortalDoor } from '@/server/services/partner-portal-service'
import { listOrdersForPartner } from '@/server/services/partner-order-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import { PortalGate } from '@/components/portal/PortalGate'
import { OrderHistory } from '@/components/portal/OrderHistory'

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
      style={{
        ['--brand' as string]: door.brandColor,
        ['--accent' as string]: door.accentColor,
      }}
    >
      <header className="border-b border-black/[0.08] bg-white">
        <div className="h-[3px] w-full" style={{ background: 'var(--brand)' }} aria-hidden />
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-6 sm:px-8">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-black/40">{door.name}</p>
            <h1 className="mt-1 font-serif text-[28px] leading-tight text-black">Purchase history</h1>
          </div>
          <Link
            href={`/p/${params.token}`}
            className="inline-flex items-center rounded-full border border-black/15 px-4 py-2 text-[12px] font-medium uppercase tracking-[0.1em] text-black/75 transition-colors hover:border-black hover:bg-black hover:text-white"
          >
            Back to stock
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8">
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
