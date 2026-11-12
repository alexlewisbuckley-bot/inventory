import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPortalDoor } from '@/server/services/partner-portal-service'
import { listCampaigns } from '@/server/services/partner-campaign-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import { PortalGate } from '@/components/portal/PortalGate'
import { CampaignList } from '@/components/portal/CampaignList'
import type { CampaignKind, CampaignStatus } from '@/lib/enums'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata: Metadata = {
  title: 'Campaigns',
  robots: { index: false, follow: false, nocache: true },
}

export default async function CampaignsPage({ params }: { params: { token: string } }) {
  const door = await getPortalDoor(params.token)
  if (!door) notFound()

  // The same door as the stock list: one passphrase for the whole portal, and
  // this screen gives away more than that one does — it can open a campaign
  // and take stock off the market.
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

  const campaigns = await listCampaigns(door.id)

  return (
    <CampaignList
      token={params.token}
      partnerName={door.name}
      campaigns={campaigns.map((row) => ({
        ...row,
        kind: row.kind as CampaignKind,
        status: row.status as CampaignStatus,
        recipientCount: Number(row.recipientCount),
        claimedCount: Number(row.claimedCount),
        itemCount: Number(row.itemCount),
      }))}
    />
  )
}
