import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { listPartners } from '@/server/services/partner-service'
import { sampleAskingPrice } from '@/server/services/partner-stock'
import { PageHeader } from '@/components/layout/PageHeader'
import { CreateAction } from '@/components/ui'
import { PartnerManager } from '@/components/reference/PartnerManager'
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
  const [partners, sampleAsking] = await Promise.all([listPartners(), sampleAskingPrice()])

  return (
    <>
      <PageHeader
        title="Partners"
        description="Companies that buy at an agreed rate off the asking price. The rate is applied to each watch's current price, so repricing a piece moves what every partner pays for it."
        actions={can(user.role, 'partner:manage') ? <CreateAction label="Add partner" /> : undefined}
      />
      <PartnerManager
        partners={partners.map((partner) => ({
          ...partner,
          displayCurrency: partner.displayCurrency as CurrencyCode,
        }))}
        sampleAsking={sampleAsking}
        canManage={can(user.role, 'partner:manage')}
      />
    </>
  )
}
