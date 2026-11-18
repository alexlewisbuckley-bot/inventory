import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCapability } from '@/server/auth/session'
import { getLeaderboard, listTeam } from '@/server/services/leaderboard-service'
import { stockForPartner } from '@/server/services/partner-portal-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { LeaderboardManager } from '@/components/leaderboard/LeaderboardManager'
import { brandVars } from '@/components/portal/ui'
import { dubaiToday } from '@/lib/delivery'

export const metadata: Metadata = { title: 'Leaderboard' }
export const dynamic = 'force-dynamic'

/**
 * A partner's leaderboard challenge, from our side.
 *
 * The same manager the partner uses in their portal, against the same rows,
 * so whoever enters the week's figures — them or us — everybody sees one
 * board. On a light panel in either theme, because it is their page.
 */
export default async function StaffLeaderboardPage({ params }: { params: { id: string; lbId: string } }) {
  await requireCapability('partner:manage')
  const board = await getLeaderboard(params.id, params.lbId).catch(() => null)
  if (!board) notFound()
  // What can be reserved as a prize, at this partner's price.
  const [stock, team] = await Promise.all([stockForPartner(board.partnerId), listTeam(board.partnerId)])

  return (
    <>
      <PageHeader
        title={board.name}
        description={`Leaderboard challenge · ${board.partnerName}`}
        actions={<Link href={`/partners/${params.id}`} className="text-small text-content-secondary hover:underline">
          Back to {board.partnerName}
        </Link>}
      />
      <div className="rounded-sm bg-white p-5 text-black sm:p-6" style={brandVars(board.brandColor, board.accentColor)}>
        <LeaderboardManager
          scope={{ kind: 'staff', partnerId: params.id }}
          board={board}
          id={board.id}
          shareToken={board.shareToken}
          isPublished={board.isPublished}
          photoBase={`/l/${board.shareToken}/photo`}
          today={dubaiToday()}
          stock={stock.map((w) => ({
            id: w.id, brandName: w.brandName, model: w.model, modelName: w.modelName,
            dial: w.dial, year: w.year, caseSizeMm: w.caseSizeMm, boxPapers: w.boxPapers,
            caseMaterial: w.caseMaterial, bracelet: w.bracelet, priceGbp: w.priceGbp, imageIds: w.imageIds,
          }))}
          team={team}
          teamPhotoBase={`/api/partners/${params.id}/team-photo`}
          teamHref={`/partners/${params.id}#team`}
          backHref={`/partners/${params.id}`}
        />
      </div>
    </>
  )
}
