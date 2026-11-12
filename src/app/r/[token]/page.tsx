import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getRecipientView } from '@/server/services/partner-campaign-service'
import { RecipientChoice } from '@/components/portal/RecipientChoice'

/** Live, and never cached: somebody else may have taken the piece this minute. */
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Says nothing, to anybody, ever.
 *
 * This link goes out by email to a few dozen people who will forward it to
 * their partners and paste it into group chats. A preview card reading
 * "Choose your watch · So-and-so" would announce the company's reward scheme
 * in every one of those places.
 */
export const metadata: Metadata = {
  title: 'Your choice',
  robots: { index: false, follow: false, nocache: true },
}

export default async function RecipientPage({ params }: { params: { token: string } }) {
  const view = await getRecipientView(params.token)
  // A link that is unknown, not yet opened, already closed or withdrawn is the
  // same nothing. Anything more specific tells whoever holds a dead link that
  // there is something real behind it.
  if (!view) notFound()

  return <RecipientChoice token={params.token} view={view} />
}
