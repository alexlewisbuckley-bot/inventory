import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPortalDoor, getPortalRoom } from '@/server/services/partner-portal-service'
import {
  getCampaign, listRecipients, shortlistIds,
} from '@/server/services/partner-campaign-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import { PortalGate } from '@/components/portal/PortalGate'
import { CampaignDetail } from '@/components/portal/CampaignDetail'
import type { CampaignKind, CampaignStatus } from '@/lib/enums'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata: Metadata = {
  title: 'Campaign',
  robots: { index: false, follow: false, nocache: true },
}

export default async function CampaignPage({ params }: { params: { token: string; id: string } }) {
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

  // Scoped by partner inside the service, so one company's id cannot reach
  // another's campaign even though ids are guessable in a way tokens are not.
  const campaign = await getCampaign(door.id, params.id).catch(() => null)
  if (!campaign) notFound()

  const [recipients, picked, room] = await Promise.all([
    listRecipients(door.id, params.id),
    shortlistIds(params.id),
    // The shortlist is chosen from the same stock the portal offers, at the
    // same prices, so the two screens can never show a different catalogue.
    campaign.kind === 'SHORTLIST' ? getPortalRoom(params.token) : Promise.resolve(null),
  ])

  return (
    <CampaignDetail
      token={params.token}
      campaign={{
        id: campaign.id,
        name: campaign.name,
        intro: campaign.intro,
        kind: campaign.kind as CampaignKind,
        budgetBase: campaign.budgetBase,
        status: campaign.status as CampaignStatus,
      }}
      recipients={recipients.map((person) => ({
        ...person,
        claimedAt: person.claimedAt ? person.claimedAt.toISOString() : null,
      }))}
      stock={(room?.items ?? []).map((item) => ({
        id: item.id,
        brandName: item.brandName,
        model: item.model,
        modelName: item.modelName,
        priceGbp: item.priceGbp,
        imageIds: item.imageIds,
      }))}
      shortlist={picked}
    />
  )
}
