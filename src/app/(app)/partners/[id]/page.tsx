import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCapability } from '@/server/auth/session'
import { getPartner } from '@/server/services/partner-service'
import {
  listCampaigns, listRecipients, shortlistIds,
} from '@/server/services/partner-campaign-service'
import { stockForPartner } from '@/server/services/partner-portal-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { PartnerCampaigns } from '@/components/reference/PartnerCampaigns'
import { PartnerBrand } from '@/components/reference/PartnerBrand'
import { can } from '@/lib/permissions'
import { percentFromBps } from '@/lib/partner-rate'
import type { CampaignKind, CampaignStatus } from '@/lib/enums'

export const metadata: Metadata = { title: 'Partner' }
export const dynamic = 'force-dynamic'

/**
 * One partner, and the campaigns they are running.
 *
 * Alex: "I cant see anywhere to run a campaign." They lived only behind a
 * company's own portal link, which put them out of reach of the people who
 * actually sell these arrangements — and most partners would rather we set
 * theirs up anyway.
 */
export default async function PartnerPage({ params }: { params: { id: string } }) {
  const user = await requireCapability('partner:read')
  const partner = await getPartner(params.id).catch(() => null)
  if (!partner) notFound()

  const campaigns = await listCampaigns(partner.id)

  /*
   * Every campaign's people and shortlist, in one pass.
   *
   * A partner has a handful of campaigns, so this is a handful of small
   * queries rather than a reason to make somebody click into each one and
   * wait. The shortlist picker needs the stock as well, and only where there
   * is a shortlist campaign to pick for.
   */
  const [recipientPairs, shortlistPairs, stock] = await Promise.all([
    Promise.all(campaigns.map(async (campaign) => [
      campaign.id, await listRecipients(partner.id, campaign.id),
    ] as const)),
    Promise.all(campaigns.map(async (campaign) => [
      campaign.id, await shortlistIds(campaign.id),
    ] as const)),
    // By partner id, not through the portal door: a shortlist has to be
    // buildable for a company whose portal has not been opened yet, and
    // asking through the door would show nothing at all.
    campaigns.some((campaign) => campaign.kind === 'SHORTLIST')
      ? stockForPartner(partner.id)
      : Promise.resolve([]),
  ])

  return (
    <>
      <PageHeader
        title={partner.name}
        description={`${percentFromBps(partner.discountBps)} off the asking price${
          partner.contactName ? ` · ${partner.contactName}` : ''
        }`}
        actions={<Link href="/partners" className="text-small text-content-secondary hover:underline">
          All partners
        </Link>}
      />

      {can(user.role, 'partner:manage') && (
        <PartnerBrand
          partner={{
            id: partner.id,
            name: partner.name,
            website: partner.website,
            brandColor: partner.brandColor,
            accentColor: partner.accentColor,
            hasLogo: partner.logoData !== null,
            brandSourceUrl: partner.brandSourceUrl,
            brandTakenAt: partner.brandTakenAt ? partner.brandTakenAt.toISOString() : null,
          }}
        />
      )}

      <PartnerCampaigns
        partnerId={partner.id}
        portalToken={partner.portalToken}
        canManage={can(user.role, 'partner:manage')}
        campaigns={campaigns.map((row) => ({
          ...row,
          kind: row.kind as CampaignKind,
          status: row.status as CampaignStatus,
          recipientCount: Number(row.recipientCount),
          claimedCount: Number(row.claimedCount),
          itemCount: Number(row.itemCount),
        }))}
        recipients={Object.fromEntries(recipientPairs.map(([id, people]) => [
          id,
          people.map((person) => ({
            ...person,
            claimedAt: person.claimedAt ? person.claimedAt.toISOString() : null,
          })),
        ]))}
        shortlists={Object.fromEntries(shortlistPairs)}
        stock={stock.map((item) => ({
          id: item.id,
          brandName: item.brandName,
          model: item.model,
          modelName: item.modelName,
          priceGbp: item.priceGbp,
          imageIds: item.imageIds,
        }))}
      />
    </>
  )
}
