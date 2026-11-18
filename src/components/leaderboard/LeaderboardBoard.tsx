import { ArrowDown, ArrowUp, Gift, Minus, Target, Trophy, Wallet, Watch } from 'lucide-react'
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
  agents: Array<{ id: string; name: string; subtitle: string | null; hasPhoto: boolean; photoVersion?: number | null; partnerAgentId?: string | null }>
  prizes: Array<{
    id: string; name: string; kind: PrizeKind; valueBase: number | null
    rule: PrizeRule; rank: number | null; targetBase: number | null
    /** For a watch reserved from stock. */
    orderId?: string | null; holdLive?: boolean; stockNo?: number | null; imageId?: string | null
  }>
  entries: Array<{ agentId: string; weekStart: string; commissionBase: number; deals: number }>
}

const aed = (base: number) => `AED ${Math.round(base / 100).toLocaleString('en-GB')}`
/** "AED 1.2m", "AED 450k" — for tight places where the full figure crowds. */
const aedShort = (base: number) => {
  const v = base / 100
  if (v >= 1_000_000) return `AED ${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}m`
  if (v >= 10_000) return `AED ${Math.round(v / 1000)}k`
  return aed(base)
}
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

const MEDALS = ['#C9A227', '#A8A9AD', '#B0703C']

/**
 * A prize's name as people should read it.
 *
 * A voucher saved with nothing but its amount for a name ("25000") reads as
 * a stray number on a board people look at from across an office; it is
 * shown as what it is instead.
 */
export function prizeLabel(prize: { name: string; kind: PrizeKind; valueBase: number | null }): string {
  const bare = prize.name.replace(/[\s,]/g, '')
  if (/^(aed)?\d+(\.\d+)?$/i.test(bare)) {
    const amount = Number(bare.replace(/^aed/i, ''))
    return `AED ${amount.toLocaleString('en-GB')} ${prize.kind === 'CASH' ? 'cash prize' : 'watch voucher'}`
  }
  return prize.name
}
const KIND_ICON: Record<PrizeKind, typeof Watch> = { WATCH: Watch, CASH: Wallet, VOUCHER: Gift }
const STATUS_TEXT: Record<BoardStatus, string> = { UPCOMING: 'Starts soon', LIVE: 'Live', ENDED: 'Finished' }

function Avatar({ name, src, size = 40, ring }: { name: string; src: string | null; size?: number; ring?: string }) {
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/[0.06] font-semibold text-black/55"
      style={{ width: size, height: size, fontSize: size * 0.36, boxShadow: ring ? `0 0 0 2px #fff, 0 0 0 4px ${ring}` : undefined }}
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
 * Laid out to be read in one screen. A slim strip carries the name, the
 * clock and the weeks; below it the standings and the prizes sit side by
 * side, so "who is winning what" is one glance across rather than a scroll
 * from the prizes down past a podium to the table. The top three are marked
 * in the table itself — gold, silver, bronze — instead of a podium that took
 * half the screen to say the same thing.
 *
 * Rendered the same for the company managing it, for our own staff and on
 * the public link an office puts on a screen.
 */
export function LeaderboardBoard({ board, photoBase, stockBase, today }: {
  board: BoardView
  /** Where agent photos are served from: `${photoBase}/${agentId}`. */
  photoBase: string
  /** Where stock photographs of prize watches are served from. */
  stockBase?: string
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
  const leader = table[0]?.total || 1
  const pot = board.prizes.reduce((sum, p) => sum + (p.valueBase ?? 0), 0)
  const countdown = time.status === 'UPCOMING'
    ? Math.max(0, Math.round((Date.parse(`${board.startsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000))
    : time.daysLeft

  return (
    <div className="space-y-4">
      {/* The challenge and the clock, in one strip. */}
      <section className="rounded-[18px] border border-black/10 bg-white px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="min-w-0 flex-1 basis-[260px]">
            <div className="flex items-center gap-2.5">
              <h2 className="truncate font-serif text-[26px] leading-tight text-black">{board.name}</h2>
              <span
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
                  time.status === 'LIVE' ? 'text-white' : 'bg-black/[0.05] text-black/60'
                }`}
                style={time.status === 'LIVE' ? { backgroundColor: 'var(--brand)' } : undefined}
              >
                {time.status === 'LIVE' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden />}
                {STATUS_TEXT[time.status]}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[13px] text-black/50">
              {board.intro || `Ranked on ${board.metricLabel.toLowerCase()}`}
              {pot > 0 && <> · <span className="text-black/70">{aed(pot)} in prizes</span></>}
            </p>
          </div>

          {/* Weeks, as segments filled as they pass. */}
          <div className="order-last w-full basis-full lg:order-none lg:w-auto lg:flex-[1.2] lg:basis-[360px]">
            <div className="flex items-center justify-between text-[11.5px] text-black/45">
              <span>{day(board.startsOn)}</span>
              <span className="font-medium text-black/70">
                {time.status === 'LIVE' ? `Week ${time.currentWeek} of ${time.totalWeeks}` : `${time.totalWeeks} weeks`}
              </span>
              <span>{day(board.endsOn)}</span>
            </div>
            <div className="mt-1.5 flex gap-1" role="img" aria-label={`${Math.round(time.progress * 100)}% of the challenge has passed`}>
              {weeks.map((w, i) => {
                const done = i + 1 < time.currentWeek || time.status === 'ENDED'
                const now = i + 1 === time.currentWeek && time.status === 'LIVE'
                return (
                  <div
                    key={w}
                    title={`Week ${i + 1} · ${day(w)}`}
                    className={`h-1.5 flex-1 rounded-full ${done || now ? '' : 'bg-black/[0.08]'}`}
                    style={done ? { backgroundColor: 'var(--brand)' } : now ? { background: 'linear-gradient(90deg, var(--brand) 50%, rgba(0,0,0,0.08) 50%)' } : undefined}
                  />
                )
              })}
            </div>
          </div>

          <div className="flex shrink-0 items-baseline gap-2">
            <span className="text-[40px] font-semibold leading-none tabular-nums text-black">{countdown}</span>
            <span className="text-[11px] font-medium uppercase leading-tight tracking-[0.14em] text-black/45">
              {time.status === 'UPCOMING' ? <>days<br />to go</> : <>{countdown === 1 ? 'day' : 'days'}<br />left</>}
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* Everybody, ranked. */}
        <section aria-label="Standings" className="overflow-hidden rounded-[18px] border border-black/10 bg-white lg:self-start">
          <header className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-black/45">Standings</h3>
            <p className="hidden text-[11px] uppercase tracking-[0.12em] text-black/35 sm:block">
              <span className="inline-block w-[92px] text-right">Latest week</span>
              <span className="inline-block w-[136px] text-right">Total</span>
            </p>
          </header>
          {board.agents.length === 0 ? (
            <p className="px-6 py-12 text-center text-[14px] text-black/45">No agents on this challenge yet.</p>
          ) : (
            <ol className="divide-y divide-black/[0.06]">
              {table.map((row) => (
                <Row
                  key={row.agentId}
                  row={row}
                  agent={byAgent.get(row.agentId)!}
                  photo={photo(row.agentId)}
                  won={prizesOf(row.agentId)}
                  next={targetsFor(board.prizes, row)[0] ?? null}
                  prizeName={(id) => { const p = board.prizes.find((x) => x.id === id); return p ? prizeLabel(p) : '' }}
                  share={row.total / leader}
                  ranked={anyFigures}
                  ended={time.status === 'ENDED'}
                />
              ))}
            </ol>
          )}
        </section>

        {/* What is up for grabs, and who is on course for it. */}
        <aside aria-label="Prizes" className="overflow-hidden rounded-[18px] border border-black/10 bg-white lg:self-start">
          <header className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-black/45">The prizes</h3>
            {pot > 0 && <span className="text-[12px] tabular-nums text-black/50">{aedShort(pot)}</span>}
          </header>
          {board.prizes.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-black/45">No prizes chosen yet.</p>
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {board.prizes.map((prize) => {
                const Icon = KIND_ICON[prize.kind]
                const who = holders.find((h) => h.prizeId === prize.id)?.holders ?? []
                const medal = prize.rule === 'RANK' && prize.rank && prize.rank <= 3 ? MEDALS[prize.rank - 1] : null
                return (
                  <li key={prize.id} className="flex gap-3 px-4 py-3">
                    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-black/[0.03]">
                      {prize.imageId && stockBase
                        /* eslint-disable-next-line @next/next/no-img-element */
                        ? <img src={`${stockBase}/${prize.imageId}`} alt="" className="h-full w-full object-contain p-1 mix-blend-multiply" />
                        : <Icon className="h-5 w-5 text-black/35" aria-hidden />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: medal ?? 'rgba(0,0,0,0.5)' }}>
                        {prize.rule === 'RANK'
                          ? <><Trophy className="h-3 w-3" aria-hidden />{ordinal(prize.rank!)} place</>
                          : <><Target className="h-3 w-3" aria-hidden />Reach {aedShort(prize.targetBase!)}</>}
                      </p>
                      <p className="mt-0.5 truncate text-[14px] font-semibold text-black" title={prizeLabel(prize)}>{prizeLabel(prize)}</p>
                      <p className="truncate text-[12px] text-black/45">
                        {PRIZE_KIND_LABELS[prize.kind]}{prize.valueBase ? ` · ${aed(prize.valueBase)}` : ''}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {who.length > 0 ? (
                          <>
                            <div className="flex -space-x-1.5">
                              {who.slice(0, 3).map((id) => (
                                <Avatar key={id} name={byAgent.get(id)?.name ?? ''} src={photo(id)} size={20} />
                              ))}
                            </div>
                            <p className="min-w-0 truncate text-[12px] text-black/65">
                              <span className="text-black/40">{time.status === 'ENDED' ? 'Won by ' : 'On course: '}</span>
                              {who.length === 1 ? byAgent.get(who[0]!)?.name : `${who.length} agents`}
                            </p>
                          </>
                        ) : (
                          <p className="text-[12px] text-black/40">Up for grabs</p>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}

function Row({ row, agent, photo, won, next, prizeName, share, ranked, ended }: {
  row: Standing
  agent: BoardView['agents'][number]
  photo: string | null
  won: BoardView['prizes']
  next: ReturnType<typeof targetsFor>[number] | null
  prizeName: (id: string) => string
  share: number
  ranked: boolean
  ended: boolean
}) {
  const placed = ranked && row.total > 0
  const medal = placed && row.rank <= 3 ? MEDALS[row.rank - 1] : null
  return (
    <li
      className="grid grid-cols-[30px_auto_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 sm:grid-cols-[34px_auto_minmax(0,1fr)_92px_136px] sm:gap-x-4 sm:px-5"
      style={medal ? { background: `linear-gradient(90deg, ${medal}14, transparent 60%)` } : undefined}
    >
      <div className="flex flex-col items-center">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full text-[12.5px] font-semibold tabular-nums ${medal ? 'text-white' : 'text-black/50'}`}
          style={medal ? { backgroundColor: medal } : undefined}
        >
          {placed ? row.rank : '–'}
        </span>
        {row.movement !== null && placed && row.movement !== 0 && (
          <span className={`flex items-center text-[10px] font-semibold ${row.movement > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {row.movement > 0 ? <ArrowUp className="h-2.5 w-2.5" aria-label="Up" /> : <ArrowDown className="h-2.5 w-2.5" aria-label="Down" />}
            {Math.abs(row.movement)}
          </span>
        )}
        {row.movement === 0 && placed && <Minus className="h-2.5 w-2.5 text-black/20" aria-label="No change" />}
      </div>

      <Avatar name={agent.name} src={photo} size={medal ? 42 : 38} ring={medal ?? undefined} />

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <p className="truncate text-[15px] font-semibold text-black">{agent.name}</p>
          <p className="truncate text-[12.5px] text-black/45">
            {[agent.subtitle, `${row.deals} ${row.deals === 1 ? 'deal' : 'deals'}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        {/* Against the leader, across the full width of the name column. */}
        <div className="mt-1.5 h-1 w-full max-w-[420px] overflow-hidden rounded-full bg-black/[0.06]">
          <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, backgroundColor: medal ?? 'var(--brand)' }} />
        </div>
        {/*
          * What they are on course for, on its own line and wrapping — never
          * cut to "Rolex 126334 D…", which is the one thing an agent reads
          * the board to find out.
          */}
        {(won.length > 0 || next) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {won.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
                <Trophy className="h-3 w-3 shrink-0" aria-hidden />{ended ? 'Won: ' : ''}{prizeLabel(p)}
              </span>
            ))}
            {next && (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2 py-0.5 text-[11.5px] text-black/55">
                <Target className="h-3 w-3 shrink-0" aria-hidden />{aedShort(next.toGo)} to {prizeName(next.prizeId)}
              </span>
            )}
          </div>
        )}
      </div>

      <p className="hidden text-right text-[13px] tabular-nums text-black/55 sm:block">
        {row.lastWeek ? `+${aedShort(row.lastWeek)}` : '—'}
      </p>
      <p className="text-right text-[16px] font-semibold tabular-nums text-black">{aed(row.total)}</p>
    </li>
  )
}
