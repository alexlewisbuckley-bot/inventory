import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPortalDoor } from '@/server/services/partner-portal-service'
import { listTeam } from '@/server/services/leaderboard-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import { PortalGate } from '@/components/portal/PortalGate'
import { PartnerMark, PortalHeader } from '@/components/portal/PortalHeader'
import { PortalNav } from '@/components/portal/PortalNav'
import { brandVars, ui } from '@/components/portal/ui'
import { TeamManager } from '@/components/leaderboard/TeamManager'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * The partner's own settings. For now, their team: the agents and photos
 * every leaderboard draws on, kept here once instead of retyped per board.
 */
export default async function PortalSettingsPage({ params }: { params: { token: string } }) {
  const door = await getPortalDoor(params.token)
  if (!door) notFound()
  if (!await hasPortalPass(params.token, door.passwordHash, door.passwordSetAt)) {
    return <PortalGate token={params.token} name={door.name} hasLogo={door.hasLogo}
      brandColor={door.brandColor} accentColor={door.accentColor} />
  }

  const team = await listTeam(door.id)

  return (
    <main className="min-h-screen bg-white" style={brandVars(door.brandColor, door.accentColor)}>
      <PortalHeader
        wide
        brand={<PartnerMark token={params.token} name={door.name} hasLogo={door.hasLogo} />}
        eyebrow="Settings"
        subtitle={`${door.name}'s people and preferences.`}
        actions={<PortalNav token={params.token} active="settings" />}
      />
      <div className={ui.page}>
        <TeamManager scope={{ kind: 'portal', token: params.token }} team={team} photoBase={`/p/${params.token}/team-photo`} />
      </div>
    </main>
  )
}
