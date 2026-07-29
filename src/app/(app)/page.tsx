import { redirect } from 'next/navigation'

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
export default function Home() {
  redirect('/today')
}
