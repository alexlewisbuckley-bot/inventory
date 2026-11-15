import { ArrowDown, ArrowUp, CalendarDays, Gift, Minus, Target, Trophy, Wallet, Watch } from 'lucide-react'
import {
  prizeHolders, standings, targetsFor, timeline, weeksOf,
  type BoardStatus, type Standing,
} from '@/lib/leaderboard'
import { PRIZE_KIND_LABELS, type PrizeKind, type PrizeRule } from '@/lib/enums'

export interface BoardView {
  name: string
  intro: string | null
  metricLabel: string
  startsOn: string
  endsOn: string
  agents: Array<{ id: string; name: string; subtitle: string | null; hasPhoto: boolean; photoVersion?: number | null }>
  prizes: Array<{
    id: string; name: string; kind: PrizeKind; valueBase: number | null
    rule: PrizeRule; rank: number | null; targetBase: number | null
  }>
  entries: Array<{ agentId: string; weekStart: string; commissionBase: number; deals: number }>
}

const aed = (base: number) => `AED ${Math.round(base / 100).toLocaleString('en-GB')}`
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}
const day = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' })

const MEDALS = ['#C9A227', '#A8A9AD', '#B0703C']
const KIND_ICON: Record<PrizeKind, typeof Watch> = { WATCH: Watch, CASH: Wallet, VOUCHER: Gift }
const STATUS_TEXT: Record<BoardStatus, string> = { UPCOMING: 'Starts soon', LIVE: 'Live', ENDED: 'Finished' }

function Avatar({ name, src, size = 44, ring }: { name: string; src: string | null; size?: number; ring?: string }) {
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/[0.06] font-semibold text-black/55"
      style={{ width: size, height: size, fontSize: size * 0.36, boxShadow: ring ? `0 0 0 3px #fff, 0 0 0 5px ${ring}` : undefined }}
    >
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={src} alt={name} className="h-full w-full object-cover" loading="lazy" />
      ) : initials}
    </span>
  )
}

/**
 * The board itself: how long is left, what is up for grabs, who is winning.
 *
 * Rendered the same for the company managing it, for our own staff and on
 * the public link an office puts on a screen — so nobody is ever looking at
 * a different order from anybody else.
 */
export function LeaderboardBoard({ board, photoBase, today }: {
  board: BoardView
  /** Where agent photos are served from: `${photoBase}/${agentId}`. */
  photoBase: string
  /** Today as YYYY-MM-DD, passed in so server and client agree. */
  today: string
}) {
  const time = timeline(board.startsOn, board.endsOn, today)
  const weeks = weeksOf(board.startsOn, board.endsOn)
  const table = standings(board.agents, board.entries)
  const holders = prizeHolders(board.prizes, table)
  const byAgent = new Map(board.agents.map((a) => [a.id, a]))
  const photo = (id: string) => {
    const agent = byAgent.get(id)
    return agent?.hasPhoto ? `${photoBase}/${id}?v=${agent.photoVersion ?? 0}` : null
  }
  const prizesOf = (agentId: string) =>
    board.prizes.filter((p) => holders.find((h) => h.prizeId === p.id)?.holders.includes(agentId))
  const anyFigures = table.some((row) => row.total > 0)
  const podium = anyFigures ? table.filter((row) => row.rank <= 3 && row.total > 0).slice(0, 3) : []
  const leader = table[0]?.total || 1

  return (
    <div className="space-y-8">
      {/* The challenge, and the clock. */}
      <section className="overflow-hidden rounded-[20px] border border-black/10 bg-white">
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-black/40">
              <Trophy className="h-3.5 w-3.5" aria-hidden /> Leaderboard challenge
            </p>
            <h2 className="mt-2 font-serif text-[32px] leading-tight text-black sm:text-[38px]">{board.name}</h2>
            {board.intro && <p className="mt-2 max-w-[640px] text-[14px] leading-relaxed text-black/60">{board.intro}</p>}
          </div>
          <div className="flex items-end gap-6 lg:text-right">
            <div>
              <p className="text-[44px] font-semibold leading-none tabular-nums text-black">
                {time.status === 'UPCOMING'
                  ? Math.max(0, Math.round((Date.parse(`${board.startsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000))
                  : time.daysLeft}
              </p>
              <p className="mt-1 text-[12px] uppercase tracking-[0.14em] text-black/45">
                {time.status === 'UPCOMING' ? 'days to go' : time.status === 'ENDED' ? 'days left' : time.daysLeft === 1 ? 'day left' : 'days left'}
              </p>
            </div>
            <span
              className={`mb-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${
                time.status === 'LIVE' ? 'text-white' : 'bg-black/[0.05] text-black/60'
              }`}
              style={time.status === 'LIVE' ? { backgroundColor: 'var(--brand)' } : undefined}
            >
              {time.status === 'LIVE' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden />}
              {STATUS_TEXT[time.status]}
            </span>
          </div>
        </div>

        {/* The timeline: one segment per week, filled as the weeks pass. */}
        <div className="border-t border-black/[0.06] bg-black/[0.015] px-6 py-5 sm:px-8">
          <div className="flex items-center justify-between text-[12px] text-black/50">
            <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" aria-hidden />{day(board.startsOn, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <span className="font-medium text-black/70">
              {time.status === 'LIVE' ? `Week ${time.currentWeek} of ${time.totalWeeks}` : `${time.totalWeeks} weeks`}
            </span>
            <span>Ends {day(board.endsOn, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
          <div className="mt-3 flex gap-1" role="img" aria-label={`${Math.round(time.progress * 100)}% of the challenge has passed`}>
            {weeks.map((w, i) => {
              const done = i + 1 < time.currentWeek || time.status === 'ENDED'
              const now = i + 1 === time.currentWeek && time.status === 'LIVE'
              return (
                <div key={w} className="group relative flex-1">
                  <div
                    className={`h-2 rounded-full ${done || now ? '' : 'bg-black/[0.08]'}`}
                    style={done ? { backgroundColor: 'var(--brand)' } : now ? { background: 'linear-gradient(90deg, var(--brand) 50%, rgba(0,0,0,0.08) 50%)' } : undefined}
                  />
                  <p className={`mt-1.5 hidden text-center text-[10.5px] sm:block ${now ? 'font-semibold text-black' : 'text-black/35'}`}>
                    W{i + 1}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* What is up for grabs. */}
      {board.prizes.length > 0 && (
        <section aria-label="Prizes">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-black/45">The prizes</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {board.prizes.map((prize) => {
              const Icon = KIND_ICON[prize.kind]
              const who = holders.find((h) => h.prizeId === prize.id)?.holders ?? []
              const medal = prize.rule === 'RANK' && prize.rank && prize.rank <= 3 ? MEDALS[prize.rank - 1] : null
              return (
                <article key={prize.id} className="flex flex-col rounded-[16px] border border-black/10 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
                      style={medal ? { backgroundColor: `${medal}22`, color: '#5b4a12' } : { backgroundColor: 'rgba(0,0,0,0.05)', color: 'rgba(0,0,0,0.65)' }}
                    >
                      {prize.rule === 'RANK'
                        ? <><Trophy className="h-3 w-3" style={medal ? { color: medal } : undefined} aria-hidden />{ordinal(prize.rank!)} place</>
                        : <><Target className="h-3 w-3" aria-hidden />Reach {aed(prize.targetBase!)}</>}
                    </span>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/[0.04] text-black/55">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                  </div>
                  <p className="mt-3 font-serif text-[18px] leading-snug text-black">{prize.name}</p>
                  <p className="mt-0.5 text-[12.5px] text-black/45">
                    {PRIZE_KIND_LABELS[prize.kind]}{prize.valueBase ? ` · ${aed(prize.valueBase)}` : ''}
                  </p>
                  <div className="mt-auto pt-4">
                    {who.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-2">
                          {who.slice(0, 4).map((id) => (
                            <Avatar key={id} name={byAgent.get(id)?.name ?? ''} src={photo(id)} size={26} />
                          ))}
                        </div>
                        <p className="min-w-0 truncate text-[12.5px] text-black/70">
                          <span className="text-black/45">{time.status === 'ENDED' ? 'Won by ' : 'On course: '}</span>
                          {who.length === 1 ? byAgent.get(who[0]!)?.name : `${who.length} agents`}
                        </p>
                      </div>
                    ) : (
                      <p className="text-[12.5px] text-black/40">Up for grabs</p>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {/* The top three, where there are figures to rank. */}
      {podium.length > 0 && (
        <section aria-label="Top three" className="mx-auto grid max-w-[760px] grid-cols-3 items-end gap-3 sm:gap-5">
          {[podium[1], podium[0], podium[2]].map((row, i) => {
            if (!row) return <div key={i} />
            const agent = byAgent.get(row.agentId)!
            const medal = MEDALS[row.rank - 1] ?? 'rgba(0,0,0,0.2)'
            const tall = row.rank === 1
            return (
              <div key={row.agentId} className="flex flex-col items-center text-center">
                <Avatar name={agent.name} src={photo(agent.id)} size={tall ? 84 : 64} ring={medal} />
                <p className="mt-3 line-clamp-1 text-[14px] font-semibold text-black">{agent.name}</p>
                <p className="text-[13px] tabular-nums text-black/60">{aed(row.total)}</p>
                <div
                  className={`mt-3 flex w-full items-start justify-center rounded-t-[14px] pt-3 text-[22px] font-semibold text-white ${tall ? 'h-28' : row.rank === 2 ? 'h-20' : 'h-14'}`}
                  style={{ backgroundColor: medal }}
                >
                  {row.rank}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* Everybody. */}
      <section aria-label="Standings">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-black/45">Standings</h3>
          <p className="text-[12px] text-black/40">Ranked on {board.metricLabel.toLowerCase()}</p>
        </div>

        {board.agents.length === 0 ? (
          <p className="mt-3 rounded-[16px] border border-dashed border-black/15 px-6 py-12 text-center text-[14px] text-black/45">
            No agents on this challenge yet.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-black/[0.06] overflow-hidden rounded-[16px] border border-black/10 bg-white">
            {table.map((row) => (
              <Row
                key={row.agentId}
                row={row}
                agent={byAgent.get(row.agentId)!}
                photo={photo(row.agentId)}
                won={prizesOf(row.agentId)}
                next={targetsFor(board.prizes, row)[0] ?? null}
                prizeName={(id) => board.prizes.find((p) => p.id === id)?.name ?? ''}
                share={row.total / leader}
                ranked={anyFigures}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function Row({ row, agent, photo, won, next, prizeName, share, ranked }: {
  row: Standing
  agent: BoardView['agents'][number]
  photo: string | null
  won: BoardView['prizes']
  next: ReturnType<typeof targetsFor>[number] | null
  prizeName: (id: string) => string
  share: number
  ranked: boolean
}) {
  const medal = ranked && row.total > 0 && row.rank <= 3 ? MEDALS[row.rank - 1] : null
  return (
    <li className="grid grid-cols-[36px_1fr_auto] items-center gap-3 px-4 py-3.5 sm:grid-cols-[44px_1fr_auto_auto] sm:gap-5 sm:px-5">
      <div className="flex flex-col items-center">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums ${medal ? 'text-white' : 'text-black/55'}`}
          style={medal ? { backgroundColor: medal } : undefined}
        >
          {ranked && row.total > 0 ? row.rank : '–'}
        </span>
        {row.movement !== null && ranked && (
          <span className={`mt-0.5 flex items-center text-[10.5px] font-semibold ${
            row.movement > 0 ? 'text-emerald-600' : row.movement < 0 ? 'text-rose-600' : 'text-black/25'
          }`}>
            {row.movement > 0 ? <ArrowUp className="h-3 w-3" aria-label="Up" /> : row.movement < 0 ? <ArrowDown className="h-3 w-3" aria-label="Down" /> : <Minus className="h-3 w-3" aria-label="No change" />}
            {row.movement !== 0 && Math.abs(row.movement)}
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={agent.name} src={photo} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-semibold text-black">{agent.name}</p>
          <p className="truncate text-[12px] text-black/45">
            {[agent.subtitle, `${row.deals} ${row.deals === 1 ? 'deal' : 'deals'}`].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      <div className="hidden text-right sm:block">
        <p className="text-[11px] uppercase tracking-[0.1em] text-black/35">Latest week</p>
        <p className="text-[13px] tabular-nums text-black/60">{row.lastWeek ? `+${aed(row.lastWeek)}` : '—'}</p>
      </div>

      <div className="text-right">
        <p className="text-[16px] font-semibold tabular-nums text-black sm:text-[18px]">{aed(row.total)}</p>
        <p className="text-[11px] uppercase tracking-[0.1em] text-black/35">Total</p>
      </div>

      {/* Its own line under the name, full width, so chips never squeeze. */}
      <div className="col-span-2 col-start-2 -mt-1 sm:col-span-3">
          {/* How far ahead, against the leader. */}
          <div className="h-1 w-full max-w-[420px] overflow-hidden rounded-full bg-black/[0.06]">
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, backgroundColor: 'var(--brand)' }} />
          </div>
          {(won.length > 0 || next) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {won.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
                  <Trophy className="h-3 w-3" aria-hidden />{p.name}
                </span>
              ))}
              {next && (
                <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2 py-0.5 text-[11.5px] text-black/55">
                  <Target className="h-3 w-3" aria-hidden />{aed(next.toGo)} to {prizeName(next.prizeId)}
                </span>
              )}
            </div>
          )}
      </div>
    </li>
  )
}
