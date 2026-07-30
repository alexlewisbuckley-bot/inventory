import { describe, expect, it } from 'vitest'
import { funnel, furthestStage, winRate, type FunnelDeal } from '@/lib/funnel'

/**
 * The funnel's awkward cases, hand-computed.
 *
 * Every fixture here is a deal shape the seed actually produces or the board
 * actually allows: created straight into a late stage, fallen back and
 * recovered, lost early, won after skipping half the rungs. The assertions
 * are worked out on paper first — a funnel test that trusts the function to
 * generate its own expectations tests nothing.
 */

const deal = (stages: FunnelDeal['stages'], valueGbp = 0): FunnelDeal => ({ stages, valueGbp })

describe('furthestStage', () => {
  it('takes the furthest point in board order, not the latest in time', () => {
    // Fell back from Negotiation to Qualified: still reached Negotiation.
    expect(furthestStage(['ENQUIRY', 'NEGOTIATION', 'QUALIFIED'])).toBe('NEGOTIATION')
  })

  it('ignores the terminal markers', () => {
    // Lost from Sourcing: the furthest *stage* is Sourcing; LOST is an outcome.
    expect(furthestStage(['ENQUIRY', 'SOURCING', 'LOST'])).toBe('SOURCING')
  })

  it('returns null for a deal with no recognisable stage', () => {
    expect(furthestStage([])).toBeNull()
  })
})

describe('funnel', () => {
  it('computes a hand-checked funnel', () => {
    const steps = funnel([
      deal(['ENQUIRY'], 100),                                  // stopped at the top
      deal(['ENQUIRY', 'QUALIFIED'], 200),                     // one rung down
      deal(['ENQUIRY', 'QUALIFIED', 'SOURCING', 'LOST'], 400), // died in sourcing
      deal(['ENQUIRY', 'WON'], 800),                           // won — travelled everything
    ])

    // Reached counts, worked out on paper:
    // ENQUIRY 4 · QUALIFIED 3 · SOURCING 2 · OFFER_SENT 1 (the winner)
    expect(steps.map((s) => s.reached)).toEqual([4, 3, 2, 1, 1, 1, 1])
    expect(steps[0]!.valueGbp).toBe(1500)
    expect(steps[1]!.valueGbp).toBe(1400)
    expect(steps[2]!.valueGbp).toBe(1200)
    expect(steps[3]!.valueGbp).toBe(800)

    expect(steps[1]!.conversionFromPrevious).toBeCloseTo(3 / 4)
    expect(steps[2]!.conversionFromPrevious).toBeCloseTo(2 / 3)
    expect(steps[3]!.conversionFromTop).toBeCloseTo(1 / 4)
  })

  it('counts a skipped stage as passed through', () => {
    // Opened straight into Negotiation: no Enquiry event exists, but the deal
    // is past Enquiry, which is what a funnel measures.
    const steps = funnel([deal(['NEGOTIATION'])])
    const byStage = Object.fromEntries(steps.map((s) => [s.stage, s.reached]))
    expect(byStage.ENQUIRY).toBe(1)
    expect(byStage.SOURCING).toBe(1)
    expect(byStage.NEGOTIATION).toBe(1)
    expect(byStage.DEPOSIT_TAKEN).toBe(0)
  })

  it('does not uncount a deal that fell back', () => {
    const steps = funnel([deal(['ENQUIRY', 'OFFER_SENT', 'QUALIFIED'])])
    const byStage = Object.fromEntries(steps.map((s) => [s.stage, s.reached]))
    expect(byStage.OFFER_SENT).toBe(1)
  })

  it('sends a won deal through the whole board', () => {
    const steps = funnel([deal(['ENQUIRY', 'WON'], 500)])
    for (const step of steps) {
      expect(step.reached).toBe(1)
      expect(step.valueGbp).toBe(500)
    }
  })

  it('reads an empty pipeline as no-deals, not zero-conversion', () => {
    const steps = funnel([])
    expect(steps[0]!.reached).toBe(0)
    // 0/0 must not render as "0%" — that claims everything falls out at the
    // first rung, which is a different and alarming statement.
    expect(steps[0]!.conversionFromPrevious).toBe(1)
    expect(steps[1]!.conversionFromTop).toBe(0)
  })
})

describe('winRate', () => {
  it('measures outcomes, not optimism', () => {
    const result = winRate([
      { stage: 'WON', valueGbp: 1000 },
      { stage: 'WON', valueGbp: 500 },
      { stage: 'LOST', valueGbp: 800 },
      // Open deals are excluded: counting them as not-yet-lost makes a busy
      // pipeline look like a failing one.
      { stage: 'NEGOTIATION', valueGbp: 9999 },
    ])
    expect(result.won).toBe(2)
    expect(result.lost).toBe(1)
    expect(result.rate).toBeCloseTo(2 / 3)
    expect(result.wonValueGbp).toBe(1500)
    expect(result.lostValueGbp).toBe(800)
  })

  it('says "nothing has closed" rather than claiming a rate', () => {
    expect(winRate([{ stage: 'ENQUIRY', valueGbp: 1 }]).rate).toBeNull()
  })
})
