import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAgentView } from '@/server/services/partner-programme-service'
import { stockForAgent } from '@/server/services/partner-programme-stock'
import { asksFromAgent } from '@/server/services/sourcing-requests'
import { AgentProgress } from '@/components/portal/AgentProgress'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Says nothing, to anybody, ever.
 *
 * The link carries a person's name, their employer's, and how much they have
 * earned this year. A preview card in a forwarded WhatsApp message would
 * hand all three to whoever it was forwarded to.
 */
export const metadata: Metadata = {
  title: 'Your year',
  robots: { index: false, follow: false, nocache: true },
}

export default async function AgentPage({ params }: { params: { token: string } }) {
  const view = await getAgentView(params.token)
  if (!view) notFound()

  /*
   * What they may choose, worked out server-side from what they have
   * unlocked. Sending the whole case and filtering in the browser would put
   * every price we quote this partner into a page an agent can read.
   */
  const choices = view.standing.capBase > 0
    ? await stockForAgent(params.token, view.standing.capBase)
    : []

  // And whatever they have already asked us to find.
  const asks = await asksFromAgent(params.token)

  return <AgentProgress token={params.token} view={view} choices={choices} asks={asks} />
}
