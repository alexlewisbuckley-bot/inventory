import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPortalDoor, stockForPartner } from '@/server/services/partner-portal-service'
import { getLeaderboard, listTeam } from '@/server/services/leaderboard-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import { PortalGate } from '@/components/portal/PortalGate'
import { PartnerMark, PortalHeader } from '@/components/portal/PortalHeader'
import { PortalNav } from '@/components/portal/PortalNav'
import { brandVars, ui } from '@/components/portal/ui'
import { LeaderboardManager } from '@/components/leaderboard/LeaderboardManager'
import { dubaiToday } from '@/lib/delivery'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata: Metadata = {
  title: 'Leaderboard',
  robots: { index: false, follow: false, nocache: true },
}

export default async function PortalLeaderboardPage({ params }: { params: { token: string; id: string } }) {
  const door = await getPortalDoor(params.token)
  if (!door) notFound()
  if (!await hasPortalPass(params.token, door.passwordHash, door.passwordSetAt)) {
    return <PortalGate token={params.token} name={door.name} hasLogo={door.hasLogo}
      brandColor={door.brandColor} accentColor={door.accentColor} />
  }

  const board = await getLeaderboard(door.id, params.id).catch(() => null)
  if (!board) notFound()
  // What can be reserved as a prize, at this partner's price.
  const [stock, team] = await Promise.all([stockForPartner(board.partnerId), listTeam(board.partnerId)])

  return (
    <main className="min-h-screen bg-white" style={brandVars(door.brandColor, door.accentColor)}>
      <PortalHeader
        wide
        brand={<PartnerMark token={params.token} name={door.name} hasLogo={door.hasLogo} />}
        eyebrow={<Link href={`/p/${params.token}/leaderboards`} className="hover:text-black">← All leaderboards</Link>}
        subtitle={<span className="font-semibold text-black">{board.name}</span>}
        actions={<PortalNav token={params.token} active="leaderboards" />}
      />
      <div className={ui.page}>
        <LeaderboardManager
          scope={{ kind: 'portal', token: params.token }}
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
          teamPhotoBase={`/p/${params.token}/team-photo`}
          teamHref={`/p/${params.token}/settings`}
          backHref={`/p/${params.token}/leaderboards`}
        />
      </div>
    </main>
  )
}
