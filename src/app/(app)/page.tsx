import { redirect } from 'next/navigation'
import { requireUser } from '@/server/auth/session'
import { landingFor } from '@/lib/permissions'

/**
 * The front door opens on the agenda, not on the inventory.
 *
 * This used to be a dashboard: four metric tiles, a flow chart, stock health,
 * capital by location, recent activity — ten regions answering "what do we
 * own?" to people whose job is selling. Nothing on it said what to do next,
 * and a screen that opens every morning without answering that question is a
 * screen people learn to scroll past. (Audit C-2.)
 *
 * Everything it showed survives under /insights, where it is looked at
 * deliberately rather than skimmed daily until it stopped being read.
 */
export default async function Home() {
  // Asked directly rather than bounced through /today, which then has to send
  // an outside party somewhere else: one hop, and the rule lives in one place.
  const user = await requireUser()
  redirect(landingFor(user.role))
}
