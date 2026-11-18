import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPortalDoor } from '@/server/services/partner-portal-service'
import { listLeaderboards } from '@/server/services/leaderboard-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import { PortalGate } from '@/components/portal/PortalGate'
import { PartnerMark, PortalHeader } from '@/components/portal/PortalHeader'
import { PortalNav } from '@/components/portal/PortalNav'
import { brandVars, ui } from '@/components/portal/ui'
import { LeaderboardList } from '@/components/leaderboard/LeaderboardList'
import { dubaiToday } from '@/lib/delivery'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata: Metadata = {
  title: 'Leaderboards',
  robots: { index: false, follow: false, nocache: true },
}

export default async function PortalLeaderboardsPage({ params }: { params: { token: string } }) {
  const door = await getPortalDoor(params.token)
  if (!door) notFound()
  if (!await hasPortalPass(params.token, door.passwordHash, door.passwordSetAt)) {
    return <PortalGate token={params.token} name={door.name} hasLogo={door.hasLogo}
      brandColor={door.brandColor} accentColor={door.accentColor} />
  }

  const rows = await listLeaderboards(door.id)

  return (
    <main className="min-h-screen bg-white" style={brandVars(door.brandColor, door.accentColor)}>
      <PortalHeader
        wide
        brand={<PartnerMark token={params.token} name={door.name} hasLogo={door.hasLogo} />}
        eyebrow="Leaderboards"
        subtitle={`Performance challenges ${door.name} runs for its agents.`}
        actions={<PortalNav token={params.token} active="leaderboards" />}
      />
      <div className={ui.page}>
        <LeaderboardList
          scope={{ kind: 'portal', token: params.token }}
          rows={rows}
          today={dubaiToday()}
          hrefFor={`/p/${params.token}/leaderboards`}
        />
      </div>
    </main>
  )
}
