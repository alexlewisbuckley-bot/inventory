import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPortalDoor } from '@/server/services/partner-portal-service'
import { getProgramme, listProgrammes } from '@/server/services/partner-programme-service'
import { hasPortalPass } from '@/server/auth/portal-pass'
import { PortalGate } from '@/components/portal/PortalGate'
import { PartnerMark, PortalHeader } from '@/components/portal/PortalHeader'
import { PortalNav } from '@/components/portal/PortalNav'
import { brandVars } from '@/components/portal/ui'
import { ProgrammeBoard } from '@/components/portal/ProgrammeBoard'
import { ProgrammeStart } from '@/components/portal/ProgrammeStart'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata: Metadata = {
  title: 'Incentive',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * The company's own incentive screen.
 *
 * Behind the same passphrase as the rest of the portal, and it needs to be:
 * this is where somebody adds people and moves the figure that decides who
 * has won a watch.
 */
export default async function ProgrammePage({ params }: { params: { token: string } }) {
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

  /*
   * The newest programme, or the form to start one.
   *
   * A chooser over a list of years is a screen for a company that has run
   * this for a decade. The one that matters is the one they are in.
   */
  const programmes = await listProgrammes(door.id)
  const current = programmes[0] ? await getProgramme(programmes[0].id) : null

  return (
    <main className="min-h-screen bg-white" style={brandVars(door.brandColor, door.accentColor)}>
      {/*
        * The same top as every other portal page.
        *
        * This screen arrived with a bare <h1> and no way back, which made it
        * read as a different product the moment you landed on it. The row of
        * links is how somebody gets from here to their campaigns.
        */}
      <PortalHeader
        brand={<PartnerMark token={params.token} name={door.name} hasLogo={door.hasLogo} />}
        eyebrow="Incentives"
        title={current?.name}
        subtitle={current === null ? 'A target for each agent, and what reaching it unlocks.' : undefined}
        actions={<PortalNav token={params.token} active="programme" />}
      />
      {current === null ? (
        <ProgrammeStart token={params.token} />
      ) : (
        <ProgrammeBoard
          token={params.token}
          data={{
            id: current.id,
            name: current.name,
            kind: current.kind,
            status: current.status,
            periodStart: current.periodStart,
            periodEnd: current.periodEnd,
            tiers: current.tiers,
            agents: current.agents.map((agent) => ({
              agentId: agent.agentId,
              goalId: agent.goalId,
              name: agent.name,
              email: agent.email,
              token: agent.token,
              targetBase: agent.targetBase,
              earnedBase: agent.earnedBase,
              asOf: agent.asOf,
              reachedLabel: agent.standing.reached?.label ?? null,
              nextLabel: agent.standing.next?.label ?? null,
              toGo: agent.standing.toGo,
              fraction: agent.standing.fraction,
              capBase: agent.standing.capBase,
              pickedLabel: agent.picked?.label ?? null,
              pickedNote: agent.picked?.note ?? null,
            })),
          }}
        />
      )}
    </main>
  )
}
