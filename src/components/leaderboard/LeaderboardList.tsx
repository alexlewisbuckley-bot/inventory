'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState, useFormStatus } from 'react-dom'
import { ChevronRight, Gift, Plus, Trophy, Users, X } from 'lucide-react'
import { saveLeaderboardAction, type LeaderboardScope, type LeaderboardState } from '@/app/actions/leaderboards'
import { timeline } from '@/lib/leaderboard'
import { ui, brandFill } from '@/components/portal/ui'

export interface LeaderboardRow {
  id: string
  name: string
  startsOn: string
  endsOn: string
  isPublished: boolean
  agentCount: number
  prizeCount: number
}

const START: LeaderboardState = { ok: false, message: '' }
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const plus = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/**
 * A partner's leaderboard challenges, and the way to start a new one.
 *
 * Creating asks only for a name and the dates — agents, prizes and figures
 * come after, on the challenge's own page, where the board shows what each
 * addition does.
 */
export function LeaderboardList({ scope, rows, today, hrefFor }: {
  scope: LeaderboardScope
  rows: LeaderboardRow[]
  today: string
  /** Where a challenge's own page is, on this side of the counter. */
  hrefFor: string
}) {
  const router = useRouter()
  const [making, setMaking] = useState(rows.length === 0)
  const [state, action] = useFormState(saveLeaderboardAction.bind(null, scope, null), START)

  useEffect(() => {
    if (state.ok && state.id) router.push(`${hrefFor}/${state.id}`)
  }, [state, router, hrefFor])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[620px] text-[13.5px] leading-relaxed text-black/60">
          A leaderboard challenge ranks your agents week by week against a set of prizes — a watch, cash,
          or a voucher towards a watch — for finishing position or for hitting a target.
        </p>
        {!making && (
          <button type="button" onClick={() => setMaking(true)} className={ui.primary} style={brandFill}>
            <Plus className="h-4 w-4" aria-hidden /> New challenge
          </button>
        )}
      </div>

      {making && (
        <form action={action} className={`${ui.card} p-5`}>
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-black">
              <Trophy className="h-4 w-4" aria-hidden /> New leaderboard challenge
            </p>
            {rows.length > 0 && (
              <button type="button" onClick={() => setMaking(false)} className={ui.iconButton} aria-label="Cancel">
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
            <label className="block"><span className={ui.label}>Name</span>
              <input name="name" required className={ui.field} placeholder="e.g. Q1 Top Performer Challenge" /></label>
            <label className="block"><span className={ui.label}>Starts</span>
              <input name="startsOn" type="date" required defaultValue={today} className={ui.field} /></label>
            <label className="block"><span className={ui.label}>Ends</span>
              <input name="endsOn" type="date" required defaultValue={plus(today, 8 * 7 - 1)} className={ui.field} /></label>
          </div>
          <input type="hidden" name="metricLabel" value="Commission earned" />
          {state.message && !state.ok && <p className={`mt-3 ${ui.error}`}>{state.message}</p>}
          <div className="mt-4 flex justify-end"><Create /></div>
        </form>
      )}

      {rows.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((row) => {
            const time = timeline(row.startsOn, row.endsOn, today)
            return (
              <li key={row.id}>
                <a href={`${hrefFor}/${row.id}`}
                  className={`${ui.card} group flex h-full flex-col p-5 transition hover:border-black/25 hover:shadow-[0_8px_30px_-18px_rgba(0,0,0,0.35)]`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-serif text-[20px] leading-snug text-black">{row.name}</p>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
                      time.status === 'LIVE' ? 'text-white' : 'bg-black/[0.05] text-black/55'
                    }`} style={time.status === 'LIVE' ? brandFill : undefined}>
                      {time.status === 'LIVE' ? `${time.daysLeft} days left` : time.status === 'UPCOMING' ? 'Starts soon' : 'Finished'}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] text-black/50">{day(row.startsOn)} – {day(row.endsOn)}</p>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                    <div className="h-full rounded-full" style={{ width: `${time.progress * 100}%`, backgroundColor: 'var(--brand)' }} />
                  </div>
                  <div className="mt-4 flex items-center gap-4 text-[12.5px] text-black/55">
                    <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" aria-hidden />{row.agentCount} agents</span>
                    <span className="flex items-center gap-1.5"><Gift className="h-3.5 w-3.5" aria-hidden />{row.prizeCount} prizes</span>
                    {row.isPublished && <span className="text-emerald-700">Shared</span>}
                    <ChevronRight className="ml-auto h-4 w-4 text-black/30 transition group-hover:translate-x-0.5 group-hover:text-black" aria-hidden />
                  </div>
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Create() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className={ui.primary} style={brandFill}>
      {pending ? 'Creating…' : 'Create and add agents'}
    </button>
  )
}
