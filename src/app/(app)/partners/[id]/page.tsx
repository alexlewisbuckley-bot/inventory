import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCapability } from '@/server/auth/session'
import { getPartner } from '@/server/services/partner-service'
import {
  listCampaigns, listRecipients, shortlistIds,
} from '@/server/services/partner-campaign-service'
import { stockForPartner } from '@/server/services/partner-portal-service'
import { listOrdersForPartner } from '@/server/services/partner-order-service'
import { OrderHistory } from '@/components/portal/OrderHistory'
import { LeaderboardList } from '@/components/leaderboard/LeaderboardList'
import { listLeaderboards } from '@/server/services/leaderboard-service'
import { brandVars } from '@/components/portal/ui'
import { dubaiToday } from '@/lib/delivery'
import { Card, CardHeader } from '@/components/ui'
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
  const [recipientPairs, shortlistPairs, stock, orders, leaderboards] = await Promise.all([
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
    listOrdersForPartner(partner.id),
    listLeaderboards(partner.id),
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

      {/*
        * What they have bought, and what it has come to.
        *
        * The same component the partner sees in their own portal, so the
        * figures on a call with them are the figures in front of them. Kept
        * on a light panel in either theme because that is how they see it.
        */}
      <Card as="section" className="mb-6">
        <CardHeader
          title="Purchase & spend history"
          description="Everything this partner has ordered, with totals. They see the same figures under Orders in their portal."
        />
        <div
          className="rounded-b-sm bg-white px-5 py-6 text-black sm:px-6"
          style={{ ['--brand' as string]: partner.brandColor }}
        >
          <OrderHistory
            showStockNo
            orders={orders.map((order) => ({
              ...order,
              placedAt: order.placedAt.toISOString(),
              completedAt: order.completedAt?.toISOString() ?? null,
              releasedAt: order.releasedAt?.toISOString() ?? null,
            }))}
          />
        </div>
      </Card>

      {can(user.role, 'partner:manage') && (
        <Card as="section" className="mb-6">
          <CardHeader
            title="Leaderboard challenges"
            description="Rank this partner's agents week by week against prizes. They manage the same challenges under Leaderboards in their portal."
          />
          <div className="rounded-b-sm bg-white px-5 py-6 text-black sm:px-6" style={brandVars(partner.brandColor, partner.accentColor)}>
            <LeaderboardList
              scope={{ kind: 'staff', partnerId: partner.id }}
              rows={leaderboards}
              today={dubaiToday()}
              hrefFor={`/partners/${partner.id}/leaderboards`}
            />
          </div>
        </Card>
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
