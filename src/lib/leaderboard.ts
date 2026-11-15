/**
 * Leaderboard arithmetic: weeks, standings, and who is on course for what.
 *
 * Pure, so the portal, the staff page and the public board all rank the same
 * way, and the rules can be held still in a test. Money is in base minor
 * units; dates are ISO calendar days (YYYY-MM-DD) and handled in UTC, because
 * a week is a calendar thing and must not move with somebody's time zone.
 */

export type BoardStatus = 'UPCOMING' | 'LIVE' | 'ENDED'

export interface BoardAgent { id: string; name: string }
export interface BoardEntry { agentId: string; weekStart: string; commissionBase: number; deals: number }
export interface BoardPrize {
  id: string
  name: string
  rule: 'RANK' | 'TARGET'
  rank: number | null
  targetBase: number | null
}

const DAY = 86_400_000
const parse = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** The Monday of the week a day falls in. */
export function weekStartOf(day: string | Date): string {
  const d = typeof day === 'string' ? parse(day) : new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()))
  const back = (d.getUTCDay() + 6) % 7
  return iso(new Date(d.getTime() - back * DAY))
}

/** Every week the challenge touches, as the Monday each starts on. */
export function weeksOf(startsOn: string, endsOn: string): string[] {
  const out: string[] = []
  const last = parse(endsOn).getTime()
  for (let t = parse(weekStartOf(startsOn)).getTime(); t <= last; t += 7 * DAY) out.push(iso(new Date(t)))
  return out
}

export interface Timeline {
  status: BoardStatus
  totalDays: number
  daysElapsed: number
  daysLeft: number
  /** 0 to 1. */
  progress: number
  totalWeeks: number
  /** 1-based; 0 before it starts. */
  currentWeek: number
}

/** Where today sits in the challenge. Both ends are inclusive days. */
export function timeline(startsOn: string, endsOn: string, today: string): Timeline {
  const start = parse(startsOn).getTime()
  const end = parse(endsOn).getTime()
  const now = parse(today).getTime()
  const totalDays = Math.round((end - start) / DAY) + 1
  const weeks = weeksOf(startsOn, endsOn)
  const status: BoardStatus = now < start ? 'UPCOMING' : now > end ? 'ENDED' : 'LIVE'
  const daysElapsed = status === 'UPCOMING' ? 0 : status === 'ENDED' ? totalDays : Math.round((now - start) / DAY) + 1
  const thisWeek = weekStartOf(today)
  const currentWeek = status === 'UPCOMING' ? 0 : status === 'ENDED' ? weeks.length : weeks.indexOf(thisWeek) + 1
  return {
    status,
    totalDays,
    daysElapsed,
    daysLeft: totalDays - daysElapsed,
    progress: totalDays ? daysElapsed / totalDays : 0,
    totalWeeks: weeks.length,
    currentWeek,
  }
}

export interface Standing {
  agentId: string
  total: number
  deals: number
  /** Competition ranking: two agents level on 1st are both 1st, the next is 3rd. */
  rank: number
  /** Places gained since the board before the latest entered week. Null with nothing to compare. */
  movement: number | null
  /** The latest entered week's figure, for the "this week" column. */
  lastWeek: number
  weeks: Record<string, number>
}

function rankTotals(totals: Array<{ agentId: string; total: number; deals: number; order: number }>) {
  const sorted = [...totals].sort((a, b) => b.total - a.total || b.deals - a.deals || a.order - b.order)
  const ranks = new Map<string, number>()
  sorted.forEach((row, i) => {
    const prev = sorted[i - 1]
    ranks.set(row.agentId, prev && prev.total === row.total && prev.deals === row.deals ? ranks.get(prev.agentId)! : i + 1)
  })
  return { sorted, ranks }
}

/** The board: every agent with their running total, ranked. */
export function standings(agents: BoardAgent[], entries: BoardEntry[]): Standing[] {
  const weeks = [...new Set(entries.map((e) => e.weekStart))].sort()
  const latest = weeks.at(-1) ?? null

  const tally = (upTo: string | null) => agents.map((agent, order) => {
    const mine = entries.filter((e) => e.agentId === agent.id && (upTo === null || e.weekStart <= upTo))
    return {
      agentId: agent.id,
      order,
      total: mine.reduce((sum, e) => sum + e.commissionBase, 0),
      deals: mine.reduce((sum, e) => sum + e.deals, 0),
    }
  })

  const now = rankTotals(tally(null))
  const before = weeks.length > 1 ? rankTotals(tally(weeks.at(-2)!)).ranks : null

  return now.sorted.map((row) => {
    const mine = entries.filter((e) => e.agentId === row.agentId)
    const rank = now.ranks.get(row.agentId)!
    return {
      agentId: row.agentId,
      total: row.total,
      deals: row.deals,
      rank,
      movement: before ? before.get(row.agentId)! - rank : null,
      lastWeek: latest ? mine.filter((e) => e.weekStart === latest).reduce((s, e) => s + e.commissionBase, 0) : 0,
      weeks: Object.fromEntries(mine.map((e) => [e.weekStart, e.commissionBase])),
    }
  })
}

export interface PrizeStatus {
  prizeId: string
  /** Agents currently on course for it: in the position, or past the target. */
  holders: string[]
}

export interface AgentTarget {
  prizeId: string
  /** 0 to 1. */
  progress: number
  toGo: number
}

/**
 * Who is on course for each prize if the board stood as it is.
 *
 * A position prize goes to whoever holds that position, and to all of them
 * where they are level — splitting it is a conversation for the company, not
 * a decision for this page. Nobody is on course with nothing entered: an
 * empty board has no winner, whatever order the names were typed in.
 */
export function prizeHolders(prizes: BoardPrize[], board: Standing[]): PrizeStatus[] {
  return prizes.map((prize) => ({
    prizeId: prize.id,
    holders: board
      .filter((row) => row.total > 0)
      .filter((row) => prize.rule === 'RANK'
        ? row.rank === prize.rank
        : prize.targetBase !== null && row.total >= prize.targetBase)
      .map((row) => row.agentId),
  }))
}

/** How far one agent is towards each target they have not reached yet. */
export function targetsFor(prizes: BoardPrize[], row: Standing): AgentTarget[] {
  return prizes
    .filter((p) => p.rule === 'TARGET' && p.targetBase && row.total < p.targetBase)
    .map((p) => ({
      prizeId: p.id,
      progress: Math.min(1, row.total / p.targetBase!),
      toGo: p.targetBase! - row.total,
    }))
    .sort((a, b) => a.toGo - b.toGo)
}
