import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { listPartners } from '@/server/services/partner-service'
import { listHeldStock } from '@/server/services/partner-order-service'
import { sampleAskingPrice } from '@/server/services/partner-stock'
import { PageHeader } from '@/components/layout/PageHeader'
import { CreateAction } from '@/components/ui'
import { PartnerManager } from '@/components/reference/PartnerManager'
import { HeldStock } from '@/components/reference/HeldStock'
import { can } from '@/lib/permissions'
import type { CurrencyCode } from '@/lib/enums'

export const metadata: Metadata = { title: 'Partners' }
export const dynamic = 'force-dynamic'

/**
 * The partner register.
 *
 * Corporates — estate agencies, brokerages, companies rewarding their own
 * people — who buy at an agreed rate rather than at retail. This page is the
 * company and its rate; the portal they log into and the campaigns they run
 * sit on top of it.
 */
export default async function PartnersPage() {
  const user = await requireCapability('partner:read')
  const [partners, sampleAsking, held] = await Promise.all([
    listPartners(), sampleAskingPrice(), listHeldStock(),
  ])

  return (
    <>
      <PageHeader
        title="Partners"
        description="Companies that buy at an agreed rate off the asking price. The rate is applied to each watch's current price, so repricing a piece moves what every partner pays for it."
        actions={can(user.role, 'partner:manage') ? <CreateAction label="Add partner" /> : undefined}
      />
      {/*
        * Held stock first, above the register.
        *
        * A hold never expires on its own, so this list is the whole of the
        * mechanism that ends one. Below the partner cards it would be a
        * footnote to a page people open to check a rate; above them it is the
        * first thing seen by whoever can do something about it.
        */}
      <HeldStock
        rows={held.map((row) => ({ ...row, placedAt: row.placedAt.toISOString() }))}
        canManage={can(user.role, 'partner:manage')}
      />
      <PartnerManager
        partners={partners.map((partner) => ({
          ...partner,
          displayCurrency: partner.displayCurrency as CurrencyCode,
          campaignCount: Number(partner.campaignCount),
        }))}
        sampleAsking={sampleAsking}
        canManage={can(user.role, 'partner:manage')}
      />
    </>
  )
}
