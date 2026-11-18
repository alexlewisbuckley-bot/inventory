import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ladderFor, standingFor, withinCap, type Tier } from '@/lib/programme'

const read = (path: string) => readFileSync(path, 'utf8')

/** A ladder in whole dirhams, written the way a company would say it. */
const m = (millions: number) => millions * 1_000_000 * 100
const k = (thousands: number) => thousands * 1_000 * 100

const LADDER: Tier[] = [
  { id: 't1', label: 'One', thresholdBase: m(1), rewardCapBase: k(25) },
  { id: 't2', label: 'Two', thresholdBase: m(2), rewardCapBase: k(50) },
  { id: 't3', label: 'Three', thresholdBase: m(3), rewardCapBase: k(95) },
]

/**
 * What a figure means against a ladder.
 *
 * Alex: "the agent if x Million AED earnt unlocks x incetive or watch". This
 * is that sentence as arithmetic, and three screens read it — the agent's
 * own page, the partner's list of their people, and ours. An off-by-one here
 * is somebody told they have unlocked a watch they have not.
 */
describe('where an agent stands', () => {
  it('unlocks a rung on the figure, not past it', () => {
    /*
     * A company that writes "2,000,000" means somebody on exactly two
     * million has done it. An agent told otherwise would be right to be
     * furious, and would be right.
     */
    const exact = standingFor(m(2), LADDER)
    expect(exact.reached?.label).toBe('Two')
    expect(exact.capBase).toBe(k(50))

    const justShort = standingFor(m(2) - 1, LADDER)
    expect(justShort.reached?.label).toBe('One')
    expect(justShort.capBase).toBe(k(25))
  })

  it('unlocks nothing at all below the first rung', () => {
    // Not the lowest cap — nothing. Somebody on nine hundred thousand has
    // not earned a watch, and a page offering them one at twenty-five
    // thousand is making a promise the company never made.
    const early = standingFor(k(900), LADDER)
    expect(early.reached).toBeNull()
    expect(early.capBase).toBe(0)
    expect(early.next?.label).toBe('One')
    expect(early.toGo).toBe(k(100))
  })

  it('says what is still to earn for the next one', () => {
    const half = standingFor(m(1) + k(500), LADDER)
    expect(half.next?.label).toBe('Two')
    expect(half.toGo).toBe(k(500))
  })

  it('measures the bar across the rung being climbed, not from zero', () => {
    /*
     * From zero, an agent halfway between the second and third rungs reads
     * as 83% for most of a year and the bar stops meaning anything. From the
     * rung below, it fills across the thing they are actually doing.
     */
    const midway = standingFor(m(2) + k(500), LADDER)
    expect(midway.fraction).toBeCloseTo(0.5, 5)
  })

  it('is finished at the top', () => {
    const done = standingFor(m(4), LADDER)
    expect(done.reached?.label).toBe('Three')
    expect(done.next).toBeNull()
    expect(done.toGo).toBeNull()
    expect(done.fraction).toBe(1)
    expect(done.capBase).toBe(k(95))
  })

  it('reads the rungs in order whatever order they were given', () => {
    // The company types them as it thinks of them, and a ladder out of order
    // would unlock the wrong cap.
    const shuffled = standingFor(m(2), [LADDER[2], LADDER[0], LADDER[1]])
    expect(shuffled.rungs.map((rung) => rung.label)).toEqual(['One', 'Two', 'Three'])
    expect(shuffled.reached?.label).toBe('Two')
  })

  it('does not divide by a span of nothing', () => {
    // Two rungs at one figure is a company's data entry, not a state to be
    // clever about. The honest answer is that the distance is covered.
    const same: Tier[] = [
      { id: 'a', label: 'A', thresholdBase: m(1), rewardCapBase: k(10) },
      { id: 'b', label: 'B', thresholdBase: m(1), rewardCapBase: k(20) },
    ]
    const standing = standingFor(m(1), same)
    expect(Number.isFinite(standing.fraction)).toBe(true)
    expect(standing.fraction).toBe(1)
  })

  it('copes with a programme nobody has set rungs on yet', () => {
    const empty = standingFor(m(5), [])
    expect(empty.reached).toBeNull()
    expect(empty.next).toBeNull()
    expect(empty.capBase).toBe(0)
  })
})

/**
 * Alex asked for both shapes, "selected by the brokerage".
 *
 * A single target is a ladder with one rung on it, expressed that way so the
 * screens read one shape. The alternative is every screen carrying two
 * branches, and the second branch being the one nobody tests.
 */
describe('one target, said as a ladder', () => {
  it('becomes the agent’s own figure', () => {
    const rungs = ladderFor('SINGLE', [
      { id: 'cap', label: 'Target', thresholdBase: 0, rewardCapBase: k(60) },
    ], { targetBase: m(6) })
    expect(rungs).toHaveLength(1)
    expect(rungs[0].thresholdBase).toBe(m(6))
    expect(rungs[0].rewardCapBase).toBe(k(60))
  })

  it('leaves a ladder programme alone', () => {
    expect(ladderFor('LADDER', LADDER, { targetBase: null })).toEqual(LADDER)
  })

  it('offers nothing to an agent nobody has given a figure', () => {
    // Rather than inventing one. A page saying "0 of 0, unlocked" is worse
    // than a page saying their target has not been set yet.
    expect(ladderFor('SINGLE', LADDER, { targetBase: null })).toEqual([])
  })

  it('falls back to the target as the cap, in the company’s favour', () => {
    /*
     * With no tier row there is nothing to say what the prize may be worth.
     * The target is the wrong answer, and it is wrong in the direction that
     * does not promise an agent more than the company offered.
     */
    const rungs = ladderFor('SINGLE', [], { targetBase: m(2) })
    expect(rungs[0].rewardCapBase).toBe(m(2))
  })
})

describe('what may be chosen', () => {
  it('allows a watch at the cap and refuses one over it', () => {
    expect(withinCap(k(50), k(50))).toBe(true)
    expect(withinCap(k(50) + 1, k(50))).toBe(false)
  })

  it('refuses everything before the first rung is reached', () => {
    expect(withinCap(k(1), 0)).toBe(false)
  })

  it('refuses a watch with no price rather than treating it as free', () => {
    // An unpriced watch is the one case where "it is under the cap" is a
    // sentence about missing data rather than about money.
    expect(withinCap(null, k(50))).toBe(false)
  })
})

describe('the progress log is a log', () => {
  it('is a table of dated rows, not a column somebody overwrites', () => {
    /*
     * Alex chose the company keeping it current: "The partner company
     * updates it ... Each update is dated and logged." A single number
     * answers "where are they now" and nothing else — not whether it has
     * moved since August, not who said so, and not whether a figure that
     * fell was a correction or a bad quarter.
     */
    const schema = read('src/server/db/schema.ts')
    expect(schema).toContain('partner_agent_progress')
    expect(schema).toMatch(/asOf: date\('as_of'\)\.notNull\(\)/)
    expect(schema).toMatch(/recordedByName: text\('recorded_by_name'\)/)
    // And the goal carries no running total of its own to disagree with it.
    const goals = schema.slice(schema.indexOf("'partner_agent_goals'"), schema.indexOf("'partner_agent_progress'"))
    expect(goals).not.toMatch(/earnedBase|currentBase|progressBase/)
  })
})

const service = read('src/server/services/partner-programme-service.ts')
const stock = read('src/server/services/partner-programme-stock.ts')
const actions = read('src/app/actions/partner-programmes.ts')
const board = read('src/components/portal/ProgrammeBoard.tsx')
const schema = read('src/server/db/schema.ts')
const migration = read('src/server/db/migrations/0073_incentive_programme.sql')
const agentPage = read('src/components/portal/AgentProgress.tsx')

/**
 * Who may do what, and how it is decided.
 *
 * There are two doors into this feature and neither is a user of the
 * application. The company's admin is inside their portal behind the
 * passphrase; an agent holds a link to one page. Getting this wrong is a
 * salesperson able to move their own figure, which is the one failure that
 * makes the whole thing worthless.
 */
describe('the two doors', () => {
  it('puts every company write behind the portal passphrase', () => {
    /*
     * A server action is a route like any other. Without this the passphrase
     * would guard the screens and nothing behind them — anybody with the
     * portal link could add themselves and record a win.
     */
    for (const write of [
      'saveProgrammeAction', 'setTiersAction', 'setProgrammeStatusAction',
      'addAgentAction', 'enrolAgentAction', 'setTargetAction', 'recordProgressAction',
    ]) {
      const fn = actions.slice(actions.indexOf(`export async function ${write}`))
      expect(fn.slice(0, 700), `${write} does not check the door`)
        .toContain('await insideOrNull(token)')
    }
  })

  it('checks the programme belongs to the company whose door it is', () => {
    /*
     * A programme id in a payload is a thing anybody can change. Without
     * this, a partner holding their own passphrase could record progress
     * against another company's agents by typing a different id.
     */
    for (const write of [
      'setTiersAction', 'setProgrammeStatusAction', 'addAgentAction',
      'enrolAgentAction', 'setTargetAction', 'recordProgressAction',
    ]) {
      const fn = actions.slice(actions.indexOf(`export async function ${write}`))
      expect(fn.slice(0, 700), `${write} does not check ownership`)
        .toContain('await ownsProgramme(door.id, programmeId)')
    }
    expect(actions).toContain('return programme !== null && programme.partnerId === partnerId')
  })

  it('gives an agent exactly one write, and it is not about money', () => {
    /*
     * An agent has no passphrase, only their link. The one thing it does is
     * say what they are aiming at — it cannot move a figure, and the service
     * refuses it once the programme has closed.
     */
    const fn = actions.slice(actions.indexOf('export async function pickRewardAction'))
    expect(fn).not.toContain('insideOrNull')
    expect(fn).toContain('pickReward({ token')
    const pick = service.slice(service.indexOf('export async function pickReward'))
    expect(pick).toContain("if (view.status !== 'OPEN')")
    expect(pick).not.toMatch(/amountBase|targetBase/)
  })

  it('serves a photograph only to a link that could be shown it', () => {
    // Otherwise the route reads any photograph in the system by guessing
    // ids, from a link somebody was sent in January.
    const fn = stock.slice(stock.indexOf('export async function agentImage'))
    expect(fn).toContain('eq(partnerAgents.token, token)')
    expect(fn).toContain("eq(watchImages.kind, 'WATCH')")
  })
})

describe('what an agent is allowed to see', () => {
  it('applies the cap in SQL, not after the whole case has been read', () => {
    // So a page cannot be made to list everything by asking for a large cap.
    const fn = stock.slice(stock.indexOf('export async function stockForAgent'))
    expect(fn).toContain('if (!token || token.length < 16 || capBase <= 0) return []')
    expect(fn).toContain('row.priceBase <= capBase')
  })

  it('prices it at the rate the company negotiated, not the asking price', () => {
    /*
     * The cap is a figure the company set against what it pays us. Measuring
     * it against the asking price would quietly hand back the discount —
     * the same mistake the campaign budget already learnt.
     */
    expect(stock).toContain('partnerPrice(row.askingBase, agent.discountBps, row.tradeBase)')
  })

  it('offers nothing at all before the first rung', () => {
    // The page asks for stock only once something is unlocked, and the
    // query refuses a cap of zero even if it were asked.
    const page = read('src/app/a/[token]/page.tsx')
    expect(page).toContain('view.standing.capBase > 0')
  })

  it('shows the same held-away rule as every other outward channel', () => {
    expect(stock.match(/locations l WHERE l\.is_on_hand/g)?.length).toBe(2)
  })

  it('tells nothing to a link preview', () => {
    // The link carries a name, an employer and a year's earnings. A preview
    // card in a forwarded message would hand all three to whoever got it.
    const page = read('src/app/a/[token]/page.tsx')
    expect(page).toContain('robots: { index: false, follow: false, nocache: true }')
  })
})

describe('the agent’s page', () => {
  it('shows the rungs it has not reached as well as the ones it has', () => {
    // A rung you have not made is the reason to keep going. Hiding it leaves
    // the page saying only what has already happened.
    expect(agentPage).toContain('view.standing.rungs.map((rung)')
    expect(agentPage).toContain("rung.reached ? 'unlocked' : 'unlocks'")
  })

  it('shows the log behind the figure', () => {
    /*
     * A single number asks to be taken on trust. The log is what makes it
     * somebody's year rather than an assertion, and the first thing an agent
     * who thinks the number is wrong will look at.
     */
    expect(agentPage).toContain('view.history.length > 1')
    expect(agentPage).toContain('How it has moved')
  })

  it('says a pick holds nothing', () => {
    // A year of agents aiming at pieces would take the case off the market
    // to give away three, so a pick is a nomination and says so.
    expect(agentPage).toContain('Choosing one does not hold it')
  })
})

/**
 * The team list is shared with the leaderboards.
 *
 * Two features arrived on the same table from two directions: a leaderboard's
 * cast list, where an agent is a name and a photograph, and this, where an
 * agent is somebody with a target and a link of their own. One list of people
 * is the right answer — nobody wants to type the same twelve names twice —
 * but it leaves rows on this board that were never meant for it.
 */
describe('agents who came from a leaderboard', () => {
  it('is one table, not two lists of the same people', () => {
    // A second table would mean a company's team depended on which screen
    // they were looking at, and a name corrected in one place staying wrong
    // in the other.
    const tables = schema.match(/pgTable\(\s*'partner_agents'/g) ?? []
    expect(tables.length, 'partner_agents is defined more than once').toBe(1)
    // And the migration adds to that table rather than building a rival.
    expect(migration).toContain('ALTER TABLE partner_agents ADD COLUMN IF NOT EXISTS token text')
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS partner_agents\b/)
  })

  it('gives one of them a link the moment they are put on a programme', () => {
    /*
     * They have no token: nothing ever sent them anywhere. Enrolling them is
     * exactly the moment they need a page, so it is minted there — otherwise
     * the row says "No link yet" for ever and the target set against them is
     * a figure nobody can see.
     */
    const fn = service.slice(service.indexOf('export async function enrolAgent'))
    const body = fn.slice(0, 1200)
    expect(body).toContain('newAgentToken()')
    // Only where there is not one already, or enrolling somebody on a second
    // programme would break the link they are already using.
    expect(body).toContain('isNull(partnerAgents.token)')
  })

  it('checks the person named works there', () => {
    /*
     * ownsProgramme says the programme is this company's. It says nothing
     * about whose person the agent id is, and an id in a payload is a thing
     * anybody can change — so without this a partner could put another
     * company's agent on their own scheme and read their link off the row.
     */
    const fn = actions.slice(actions.indexOf('export async function enrolAgentAction'))
    expect(fn.slice(0, 900)).toContain('await ownsAgent(door.id, agentId)')
    expect(actions).toContain('eq(partnerAgents.partnerId, partnerId)')
  })

  it('does not offer a target box that saves nothing', () => {
    /*
     * The board lists everybody at the company, so somebody not on this
     * year's programme has no goal for a target or a figure to be saved
     * against. Those inputs used to render all the same and their buttons
     * did nothing at all — the same silent failure as a tick that does not
     * stick, which is the bug Alex has been bitten by twice.
     */
    const row = board.slice(board.indexOf('function AgentRowView'))
    const unenrolled = row.slice(0, row.indexOf('return (\n    <li className="py-4">'))
    expect(unenrolled).toContain('if (agent.goalId === null)')
    expect(unenrolled).toContain('Add to this programme')
    expect(unenrolled).not.toContain('Earned so far')
  })
})
