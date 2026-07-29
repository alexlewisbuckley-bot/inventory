import { describe, expect, it } from 'vitest'
import {
  humanDuration, stageHistory, stagePosition, type StageEvent,
} from '@/lib/deal-stages'
import type { DealStage } from '@/lib/enums'

/**
 * The stage rail's arithmetic.
 *
 * Every case here is a data shape rather than a screen — a deal that skipped
 * four stages, one that went backwards, one seeded straight into a late stage
 * with no events at all. They are the cases that break a rail, and they are
 * all painful to produce by clicking, which is exactly why they belong here.
 */

const DAY = 86_400_000
const at = (day: number) => new Date(Date.UTC(2026, 0, 1 + day))
const NOW = at(30)

const move = (from: DealStage | null, to: DealStage, day: number): StageEvent =>
  ({ fromStage: from, toStage: to, at: at(day) })

describe('stageHistory', () => {
  it('measures a straightforward run through three stages', () => {
    const history = stageHistory({
      createdAt: at(0),
      events: [move('ENQUIRY', 'QUALIFIED', 4), move('QUALIFIED', 'OFFER_SENT', 10)],
      currentStage: 'OFFER_SENT',
      now: NOW,
    })

    expect(history.visits.map((v) => v.stage)).toEqual(['ENQUIRY', 'QUALIFIED', 'OFFER_SENT'])
    expect(history.dwellByStage.ENQUIRY).toBe(4 * DAY)
    expect(history.dwellByStage.QUALIFIED).toBe(6 * DAY)
    expect(history.dwellByStage.OFFER_SENT).toBe(20 * DAY)
    expect(history.ageMs).toBe(30 * DAY)
    expect(history.currentMs).toBe(20 * DAY)
  })

  it('leaves skipped stages unreached rather than at zero', () => {
    // The difference matters on the rail: a stage with 0ms looks like it was
    // passed through instantly, and a stage that was never entered was not
    // passed through at all. Only the second is true here.
    const history = stageHistory({
      createdAt: at(0),
      events: [move('ENQUIRY', 'DEPOSIT_TAKEN', 3)],
      currentStage: 'DEPOSIT_TAKEN',
      now: NOW,
    })

    expect(history.reached).toEqual(['ENQUIRY', 'DEPOSIT_TAKEN'])
    expect(history.dwellByStage.QUALIFIED).toBeUndefined()
    expect(history.dwellByStage.SOURCING).toBeUndefined()
    expect(history.dwellByStage.OFFER_SENT).toBeUndefined()
  })

  it('accumulates a stage entered twice after moving backwards', () => {
    const history = stageHistory({
      createdAt: at(0),
      events: [
        move('ENQUIRY', 'QUALIFIED', 2),
        move('QUALIFIED', 'NEGOTIATION', 5),
        move('NEGOTIATION', 'QUALIFIED', 8),   // it fell back
        move('QUALIFIED', 'NEGOTIATION', 12),
      ],
      currentStage: 'NEGOTIATION',
      now: NOW,
    })

    // Three days the first time, four the second.
    expect(history.dwellByStage.QUALIFIED).toBe(7 * DAY)
    // Three days before it fell back, eighteen since.
    expect(history.dwellByStage.NEGOTIATION).toBe(21 * DAY)
    expect(history.reached).toEqual(['ENQUIRY', 'QUALIFIED', 'NEGOTIATION'])
    expect(history.visits).toHaveLength(5)
  })

  it('reports a deal with no events at all as inferred', () => {
    // Seeded and imported deals have no stage events. The rail must show
    // something, and it must not pretend the something was measured.
    const history = stageHistory({
      createdAt: at(0), events: [], currentStage: 'PAYMENT_PENDING', now: NOW,
    })

    expect(history.visits).toHaveLength(1)
    expect(history.visits[0]!.stage).toBe('PAYMENT_PENDING')
    expect(history.visits[0]!.inferred).toBe(true)
    expect(history.currentMs).toBe(30 * DAY)
    expect(history.reached).toEqual(['PAYMENT_PENDING'])
  })

  it('believes the deal over the events when they disagree', () => {
    const history = stageHistory({
      createdAt: at(0),
      events: [move('ENQUIRY', 'QUALIFIED', 3)],
      currentStage: 'WON',
      now: NOW,
    })

    const last = history.visits[history.visits.length - 1]!
    expect(last.stage).toBe('WON')
    expect(last.inferred).toBe(true)
    // The unrecorded move is dated from the last thing that was recorded,
    // which is the only honest answer available.
    expect(last.enteredAt).toEqual(at(3))
  })

  it('sorts events that arrive out of order', () => {
    const jumbled = stageHistory({
      createdAt: at(0),
      events: [move('QUALIFIED', 'OFFER_SENT', 10), move('ENQUIRY', 'QUALIFIED', 4)],
      currentStage: 'OFFER_SENT',
      now: NOW,
    })
    const ordered = stageHistory({
      createdAt: at(0),
      events: [move('ENQUIRY', 'QUALIFIED', 4), move('QUALIFIED', 'OFFER_SENT', 10)],
      currentStage: 'OFFER_SENT',
      now: NOW,
    })
    expect(jumbled.dwellByStage).toEqual(ordered.dwellByStage)
  })

  it('never produces a negative duration from a clock problem', () => {
    // An event stamped before the deal existed is a clock skew, not a deal
    // that moved backwards in time. Showing "-3 days" is how a reader decides
    // to stop believing every other number on the page.
    const history = stageHistory({
      createdAt: at(10),
      events: [move('ENQUIRY', 'QUALIFIED', 2)],
      currentStage: 'QUALIFIED',
      now: NOW,
    })

    for (const visit of history.visits) expect(visit.ms).toBeGreaterThanOrEqual(0)
    expect(history.dwellByStage.ENQUIRY).toBe(0)
    expect(history.dwellByStage.QUALIFIED).toBe(20 * DAY)
  })

  it('ignores a move into the stage it is already in', () => {
    const history = stageHistory({
      createdAt: at(0),
      events: [move('ENQUIRY', 'QUALIFIED', 3), move('QUALIFIED', 'QUALIFIED', 6)],
      currentStage: 'QUALIFIED',
      now: NOW,
    })
    expect(history.visits).toHaveLength(2)
    expect(history.dwellByStage.QUALIFIED).toBe(27 * DAY)
  })

  it('handles a deal created and read in the same instant', () => {
    const instant = new Date(Date.UTC(2026, 0, 1))
    const history = stageHistory({
      createdAt: instant, events: [], currentStage: 'ENQUIRY', now: instant,
    })
    expect(history.ageMs).toBe(0)
    expect(history.currentMs).toBe(0)
  })
})

describe('stagePosition', () => {
  it('places stages relative to the board order, not the history', () => {
    expect(stagePosition('ENQUIRY', 'NEGOTIATION')).toBe('past')
    expect(stagePosition('NEGOTIATION', 'NEGOTIATION')).toBe('current')
    expect(stagePosition('WON', 'NEGOTIATION')).toBe('future')
  })

  it('calls a stage the deal has been through "future" when it fell back', () => {
    // Deliberate. The marker shows where the deal *is*; the filled pips show
    // where it has been. Conflating the two is how a rail tells you a deal is
    // further along than it is.
    expect(stagePosition('NEGOTIATION', 'QUALIFIED')).toBe('future')
  })
})

describe('humanDuration', () => {
  it('speaks in the units a person would use', () => {
    expect(humanDuration(30_000)).toBe('just now')
    expect(humanDuration(45 * 60_000)).toBe('45 min')
    expect(humanDuration(5 * 3_600_000)).toBe('5 hr')
    expect(humanDuration(DAY)).toBe('1 day')
    expect(humanDuration(9 * DAY)).toBe('9 days')
    expect(humanDuration(21 * DAY)).toBe('3 weeks')
    expect(humanDuration(200 * DAY)).toBe('6 months')
  })

  it('refuses to render nonsense', () => {
    expect(humanDuration(-1)).toBe('—')
    expect(humanDuration(Number.NaN)).toBe('—')
  })
})
