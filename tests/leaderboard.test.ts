import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { prizeHolders, standings, targetsFor, timeline, weekStartOf, weeksOf } from '@/lib/leaderboard'
import { ordinal } from '@/components/leaderboard/LeaderboardBoard'

const agents = [{ id: 'a', name: 'Sara' }, { id: 'b', name: 'Omar' }, { id: 'c', name: 'Lena' }]
const e = (agentId: string, weekStart: string, aed: number, deals = 1) =>
  ({ agentId, weekStart, commissionBase: aed * 100, deals })

describe('weeks and the clock', () => {
  it('starts weeks on a Monday', () => {
    expect(weekStartOf('2026-11-15')).toBe('2026-11-09') // a Sunday
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16') // a Monday
  })

  it('lists every week the challenge touches', () => {
    expect(weeksOf('2026-11-04', '2026-11-20')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16'])
  })

  it('knows where today sits', () => {
    const t = timeline('2026-11-02', '2026-11-29', '2026-11-15')
    expect(t.status).toBe('LIVE')
    expect(t.totalDays).toBe(28)
    expect(t.daysLeft).toBe(14)
    expect(t.currentWeek).toBe(2)
    expect(t.totalWeeks).toBe(4)
    expect(timeline('2026-12-01', '2026-12-31', '2026-11-15').status).toBe('UPCOMING')
    expect(timeline('2026-10-01', '2026-10-31', '2026-11-15')).toMatchObject({ status: 'ENDED', daysLeft: 0 })
  })
})

describe('the standings', () => {
  const entries = [e('a', '2026-11-02', 900), e('b', '2026-11-02', 1200), e('a', '2026-11-09', 1500), e('b', '2026-11-09', 100)]
  const table = standings(agents, entries)

  it('ranks on running totals, highest first', () => {
    expect(table.map((r) => [r.agentId, r.total / 100])).toEqual([['a', 2400], ['b', 1300], ['c', 0]])
  })

  it('shows who moved since the week before', () => {
    expect(table.find((r) => r.agentId === 'a')!.movement).toBe(1)
    expect(table.find((r) => r.agentId === 'b')!.movement).toBe(-1)
  })

  it('reports the latest week on its own', () => {
    expect(table.find((r) => r.agentId === 'a')!.lastWeek).toBe(150000)
  })

  it('shares a position when two are level', () => {
    const tied = standings(agents, [e('a', '2026-11-02', 500), e('b', '2026-11-02', 500), e('c', '2026-11-02', 100)])
    expect(tied.map((r) => r.rank)).toEqual([1, 1, 3])
  })
})

describe('the prizes', () => {
  const prizes = [
    { id: 'gold', name: 'Rolex', rule: 'RANK' as const, rank: 1, targetBase: null },
    { id: 'goal', name: 'Voucher', rule: 'TARGET' as const, rank: null, targetBase: 200000 },
  ]

  it('gives positions to whoever holds them and targets to everyone past them', () => {
    const table = standings(agents, [e('a', '2026-11-02', 2500), e('b', '2026-11-02', 2100), e('c', '2026-11-02', 100)])
    const held = Object.fromEntries(prizeHolders(prizes, table).map((p) => [p.prizeId, p.holders]))
    expect(held.gold).toEqual(['a'])
    expect(held.goal).toEqual(['a', 'b'])
  })

  it('awards nothing on an empty board', () => {
    expect(prizeHolders(prizes, standings(agents, [])).every((p) => p.holders.length === 0)).toBe(true)
  })

  it('says how far each agent is from a target', () => {
    const row = standings(agents, [e('c', '2026-11-02', 500)]).find((r) => r.agentId === 'c')!
    expect(targetsFor(prizes, row)).toEqual([{ prizeId: 'goal', progress: 0.25, toGo: 150000 }])
  })

  it('writes positions the way people say them', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd'])
  })
})

describe('who may touch a board', () => {
  const service = readFileSync('src/server/services/leaderboard-service.ts', 'utf8')
  const actions = readFileSync('src/app/actions/leaderboards.ts', 'utf8')

  it('checks the partner owns the board on every write', () => {
    for (const fn of ['updateLeaderboard', 'setLeaderboardPublished', 'deleteLeaderboard', 'addAgent', 'setAgentPhoto', 'removeAgent', 'addPrize', 'removePrize', 'saveWeek']) {
      const body = service.slice(service.indexOf(`export async function ${fn}(`))
      expect(body.slice(0, body.indexOf('\n}\n')), fn).toContain('await owned(partnerId, leaderboardId)')
    }
  })

  it('lets partners in through the portal pass and staff through the partner capability', () => {
    expect(actions).toContain('hasPortalPass(')
    expect(actions).toContain("requireCapability('partner:manage')")
  })

  it('serves the public board only once published, and never takes SVG photos', () => {
    expect(service).toContain('return board?.isPublished ? board : null')
    expect(service).not.toMatch(/PHOTO_TYPES = \[[^\]]*svg/)
  })
})
