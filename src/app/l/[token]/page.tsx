import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSharedLeaderboard } from '@/server/services/leaderboard-service'
import { brandVars } from '@/components/portal/ui'
import { LeaderboardBoard } from '@/components/leaderboard/LeaderboardBoard'
import { AutoRefresh } from '@/components/leaderboard/AutoRefresh'
import { dubaiToday } from '@/lib/delivery'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata: Metadata = {
  title: 'Leaderboard',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * The public board: what a company sends its agents or puts on an office
 * screen.
 *
 * Read-only, found by a long random token, and answering only while the
 * company has the link switched on. It refreshes itself every few minutes so
 * a screen left on a wall stays current without anybody touching it.
 */
export default async function SharedLeaderboardPage({ params }: { params: { token: string } }) {
  const board = await getSharedLeaderboard(params.token)
  if (!board) notFound()

  return (
    <main className="lb-public" style={brandVars(board.brandColor, board.accentColor)}>
      {/* The page colour as a fixed layer: unaffected by the board's own zoom. */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-black/[0.03] to-white" aria-hidden />
      <AutoRefresh />
      <header className="border-b border-black/[0.08] bg-white">
        <div className="h-[3px] w-full" style={{ background: 'var(--brand)' }} aria-hidden />
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-6 px-5 py-5 sm:px-8">
          {board.hasLogo ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={`/l/${params.token}/logo`} alt={board.partnerName} className="h-11 w-auto object-contain" />
          ) : (
            <p className="font-serif text-[26px] leading-none" style={{ color: 'var(--brand)' }}>{board.partnerName}</p>
          )}
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-black/40">Live leaderboard</p>
        </div>
      </header>
      <div className="mx-auto max-w-[1480px] px-5 py-8 sm:px-8">
        <LeaderboardBoard board={board} photoBase={`/l/${params.token}/photo`} stockBase={`/l/${params.token}/stock`} today={dubaiToday()} />
      </div>
    </main>
  )
}
