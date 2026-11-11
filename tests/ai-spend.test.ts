import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { costMicros, formatMicros, MODEL_PRICES } from '@/lib/ai-pricing'
import { monthStart, AI_FEATURES, AI_FEATURE_LABELS } from '@/server/services/ai-usage'
import { SETTING_SPECS } from '@/lib/settings-specs'

const read = (path: string) => readFileSync(path, 'utf8')
const usage = read('src/server/services/ai-usage.ts')
const SERVICES = {
  invoice: 'src/server/services/invoice-ai.ts',
  gap: 'src/server/services/gap-ai.ts',
  'watch-photo': 'src/server/services/watch-ai.ts',
  'xero-screenshot': 'src/server/services/xero-vision.ts',
} as const

/**
 * What the AI costs, and a ceiling on it.
 *
 * Alex: "5 cent per watch is fine but why does the claude API keep going off
 * and how do i retain it in the system to work for AI based work and check
 * and manage the costs."
 *
 * Four features called a model and none of them left a trace anybody could
 * add up. The token counts came back on every response and went into the
 * log, visible to whoever had it open at the time and to nobody afterwards.
 */

describe('turning tokens into money', () => {
  it('prices a reading of two photographs at about four cents', () => {
    // The figure quoted to Alex, which is where this whole conversation
    // started — so it is worth a test rather than an estimate.
    expect(formatMicros(costMicros('claude-opus-5-5', 9_000, 200)!)).toBe('4.0¢')
  })

  it('does the arithmetic per million tokens', () => {
    // $4 per million in, $20 per million out.
    expect(costMicros('claude-opus-5-5', 1_000_000, 0)).toBe(4_000_000)
    expect(costMicros('claude-opus-5-5', 0, 1_000_000)).toBe(20_000_000)
    expect(costMicros('claude-opus-5-5', 0, 0)).toBe(0)
  })

  it('calls an unpriced model unknown rather than free', () => {
    /*
     * Zero would report a month of spending as costing nothing, which is the
     * one wrong answer nobody goes looking for. Null travels through to the
     * page, which says the total is short.
     */
    expect(costMicros('some-model-we-have-not-priced', 10_000, 500)).toBeNull()
  })

  it('prices every model the application actually names', () => {
    // A service naming a model missing from the table would silently stop
    // counting, so the two lists are checked against each other.
    for (const [feature, path] of Object.entries(SERVICES)) {
      const model = /const MODEL = '([^']+)'/.exec(read(path))?.[1]
      expect(model, feature).toBeDefined()
      expect(MODEL_PRICES[model!], `${feature} uses ${model}`).toBeDefined()
    }
  })

  it('reads small amounts in cents and large ones in dollars', () => {
    expect(formatMicros(0)).toBe('$0.00')
    expect(formatMicros(7_800)).toBe('0.78¢')
    expect(formatMicros(900_000)).toBe('90.0¢')
    expect(formatMicros(1_240_000)).toBe('$1.24')
  })
})

describe('the month the budget runs on', () => {
  it('is the shop’s month, not the server’s', () => {
    /*
     * Dubai is four hours ahead, so for the first four hours of the first of
     * a month the server is still in the previous one. A budget on the
     * server's calendar hands back a month's allowance in the small hours of
     * the wrong day — the same fault that was fixed across the reports.
     */
    const justAfterMidnightInDubai = new Date('2026-11-01T02:00:00Z')
    expect(monthStart(justAfterMidnightInDubai).toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })

  it('does not roll over early in the server’s evening', () => {
    expect(monthStart(new Date('2026-11-30T21:00:00Z')).toISOString()).toBe('2026-12-01T00:00:00.000Z')
  })
})

describe('the ceiling', () => {
  it('counts money that was spent, not calls that succeeded', () => {
    /*
     * A refusal that read nine thousand tokens of photographs before
     * declining cost exactly as much as one that answered. A ceiling
     * ignoring it would be counting something other than money, and would
     * disagree with the total on the page beside it.
     */
    const body = usage.slice(usage.indexOf('export async function budgetState'))
    expect(body).not.toMatch(/eq\(aiUsage\.ok, true\)/)
    expect(body).toMatch(/where\(gte\(aiUsage\.createdAt, monthStart\(now\)\)\)/)
  })

  it('means no ceiling when nothing is set', () => {
    // The behaviour everything had before this existed, and the default.
    expect(usage).toMatch(/if \(limitUsd === null \|\| !Number\.isFinite\(limitUsd\) \|\| limitUsd <= 0\)/)
  })

  it('does not fail closed when it cannot be read', () => {
    /*
     * A budget that took the features out because a setting could not be
     * read would be the exact failure this file exists to stop — silent,
     * and indistinguishable from a lapsed key.
     */
    const body = usage.slice(usage.indexOf('export async function spendingAllowed'))
    expect(body).toMatch(/catch[\s\S]*return \{ allowed: true, reason: null \}/)
  })

  it('is offered as a setting somebody can change, blank included', () => {
    const spec = SETTING_SPECS.find((s) => s.key === 'ai.monthlyBudgetUsd')
    expect(spec).toBeDefined()
    expect(spec!.validate?.('')).toBeNull()
    expect(spec!.validate?.('25')).toBeNull()
    expect(spec!.validate?.('-1')).not.toBeNull()
    expect(spec!.validate?.('banana')).not.toBeNull()
  })
})

describe('every feature that spends', () => {
  it('asks the ceiling before it builds the request', () => {
    // A ceiling checked after the money is spent is a report, not a ceiling.
    for (const [feature, path] of Object.entries(SERVICES)) {
      const source = read(path)
      const gate = source.indexOf('await spendingAllowed()')
      const send = source.indexOf('new Anthropic({')
      expect(gate, `${feature}: no budget check`).toBeGreaterThan(-1)
      expect(gate, `${feature}: checks the budget after sending`).toBeLessThan(send)
    }
  })

  it('writes down what it spent', () => {
    for (const [feature, path] of Object.entries(SERVICES)) {
      expect(read(path), feature).toMatch(new RegExp(`feature: '${feature}'`))
      expect(read(path), feature).toMatch(/inputTokens: response\.usage\.input_tokens/)
    }
  })

  it('writes down the failures too, which is how a lapsed key shows up', () => {
    /*
     * The thing Alex could not see: a key that lapsed on a Tuesday was found
     * on a Thursday by somebody trying to book in a watch. A row per failure
     * puts a date on it.
     */
    for (const [feature, path] of Object.entries(SERVICES)) {
      expect(read(path), feature).toMatch(new RegExp(`feature: '${feature}', model: MODEL, ok: false`))
    }
  })

  it('has a label for each, so a bill can be read', () => {
    for (const feature of AI_FEATURES) {
      expect(AI_FEATURE_LABELS[feature], feature).toBeTruthy()
    }
    expect(Object.keys(SERVICES).sort()).toEqual([...AI_FEATURES].sort())
  })
})

describe('recording never breaks the thing it describes', () => {
  it('swallows its own failures', () => {
    // A reading that worked must not be reported as broken because the row
    // describing it could not be written.
    const start = usage.indexOf('export async function recordUsage')
    const body = usage.slice(start, usage.indexOf('\nexport ', start + 10))
    expect(body).toMatch(/catch[\s\S]*logger\.warn\('could not record AI usage'/)
  })
})
