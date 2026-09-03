import { describe, expect, it } from 'vitest'
import {
  VAT_RECHECK_DAYS, daysSince, registerCheckState, vatCheckState, vatRecheckDueAt,
  watchChecks, worstTone,
} from '@/lib/checks'

/**
 * The traffic lights.
 *
 * Worth testing hard because the whole feature is a colour, and the two
 * mistakes a colour can make are opposite and both expensive: green on
 * something nobody checked, and red on something that is merely unknown.
 */

const NOW = new Date('2026-09-03T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

const supplier = (over: Partial<Parameters<typeof vatCheckState>[0]> = {}) => ({
  vatNo: '454273686',
  entityType: 'LIMITED_COMPANY' as const,
  vatCheckStatus: 'REGISTERED' as const,
  vatCheckedAt: daysAgo(1),
  ...over,
})

describe('the supplier VAT light', () => {
  it('is green while a confirmed registration is still in date', () => {
    expect(vatCheckState(supplier({ vatCheckedAt: daysAgo(0) }), NOW).tone).toBe('GREEN')
    expect(vatCheckState(supplier({ vatCheckedAt: daysAgo(89) }), NOW).tone).toBe('GREEN')
  })

  it('turns amber the day after the check expires, not before', () => {
    // The boundary itself, spelled out: ninety days is still in date.
    expect(vatCheckState(supplier({ vatCheckedAt: daysAgo(VAT_RECHECK_DAYS) }), NOW).tone).toBe('GREEN')
    const lapsed = vatCheckState(supplier({ vatCheckedAt: daysAgo(VAT_RECHECK_DAYS + 1) }), NOW)
    expect(lapsed.tone).toBe('AMBER')
    expect(lapsed.label).toBe('Re-check due')
  })

  it('says how long is left, so the date is not a thing to work out', () => {
    const state = vatCheckState(supplier({ vatCheckedAt: daysAgo(30) }), NOW)
    expect(state.detail).toContain('30 days ago')
    expect(state.detail).toContain(`${VAT_RECHECK_DAYS - 30} days`)
  })

  it('is red when HMRC holds no such registration', () => {
    const state = vatCheckState(supplier({ vatCheckStatus: 'NOT_FOUND' }), NOW)
    expect(state.tone).toBe('RED')
    expect(state.detail).toMatch(/do not reclaim vat/i)
  })

  it('is red when the number fails its own check digits', () => {
    expect(vatCheckState(supplier({ vatCheckStatus: 'MALFORMED' }), NOW).tone).toBe('RED')
  })

  it('is amber, never red, when HMRC could not be reached', () => {
    // The distinction the whole scheme rests on. An outage is our problem;
    // colouring it red puts a good supplier in the danger column for somebody
    // else's downtime, and people stop believing the red ones.
    const state = vatCheckState(supplier({ vatCheckStatus: 'UNAVAILABLE' }), NOW)
    expect(state.tone).toBe('AMBER')
    expect(state.detail).toMatch(/says nothing about the supplier/i)
  })

  it('is amber when nobody has asked yet', () => {
    expect(vatCheckState(supplier({ vatCheckStatus: 'UNCHECKED', vatCheckedAt: null }), NOW).tone).toBe('AMBER')
  })

  it('does not report a stale answer about a number that has since been removed', () => {
    // The failure mode this ordering exists to prevent: a green light left
    // over from a check made against a VAT number the record no longer holds.
    const state = vatCheckState(supplier({ vatNo: null }), NOW)
    expect(state.tone).toBe('AMBER')
    expect(state.label).toBe('No VAT number')
  })

  it('does not scold a private seller for having no VAT number', () => {
    const state = vatCheckState(
      supplier({ vatNo: null, entityType: 'PRIVATE_SELLER', vatCheckStatus: 'UNCHECKED' }),
      NOW,
    )
    expect(state.tone).toBe('AMBER')
    expect(state.label).toBe('Not VAT registered')
    expect(state.detail).toMatch(/nothing to check/i)
  })

  it('will not call a registration green without knowing when it was checked', () => {
    const state = vatCheckState(supplier({ vatCheckedAt: null }), NOW)
    expect(state.tone).toBe('AMBER')
  })
})

describe('the watch register light', () => {
  const watch = (over: Partial<Parameters<typeof registerCheckState>[0]> = {}) => ({
    serial: '8Q371049',
    registerCheckStatus: 'CLEAR' as const,
    registerCheckedAt: daysAgo(2),
    ...over,
  })

  it('is green once the serial has been searched and nothing came back', () => {
    const state = registerCheckState(watch(), NOW)
    expect(state.tone).toBe('GREEN')
    expect(state.detail).toContain('2 days ago')
  })

  it('does not expire, unlike the VAT check', () => {
    // Deliberate asymmetry, recorded so a later change to one is not silently
    // applied to the other.
    expect(registerCheckState(watch({ registerCheckedAt: daysAgo(900) }), NOW).tone).toBe('GREEN')
  })

  it('is red when the serial is on the register', () => {
    const state = registerCheckState(watch({ registerCheckStatus: 'RECORDED' }), NOW)
    expect(state.tone).toBe('RED')
    expect(state.detail).toMatch(/do not sell/i)
  })

  it('keeps a recorded hit red even if the serial is later cleared off the record', () => {
    expect(registerCheckState(watch({ serial: null, registerCheckStatus: 'RECORDED' }), NOW).tone).toBe('RED')
  })

  it('is amber with nothing to search on', () => {
    const state = registerCheckState(watch({ serial: null, registerCheckStatus: 'UNCHECKED' }), NOW)
    expect(state.tone).toBe('AMBER')
    expect(state.label).toBe('No serial to check')
  })

  it('goes back to work when a serial is filled in after the fact', () => {
    // Derived from the serial rather than from a stored NO_SERIAL, so adding
    // the serial re-opens the job instead of leaving it parked.
    const state = registerCheckState(watch({ registerCheckStatus: 'NO_SERIAL' }), NOW)
    expect(state.tone).toBe('AMBER')
    expect(state.label).toBe('Not checked')
  })

  it('is amber when nobody has searched yet', () => {
    const state = registerCheckState(watch({ registerCheckStatus: 'UNCHECKED', registerCheckedAt: null }), NOW)
    expect(state.tone).toBe('AMBER')
    expect(state.detail).toContain('8Q371049')
  })
})

describe('the two together', () => {
  const facts = (over = {}) => ({ ...supplier(), serial: 'X1', registerCheckStatus: 'CLEAR' as const, registerCheckedAt: daysAgo(1), ...over })

  it('is green only when both are', () => {
    expect(watchChecks(facts(), NOW).tone).toBe('GREEN')
  })

  it('takes the worse of the two', () => {
    expect(watchChecks(facts({ registerCheckStatus: 'UNCHECKED' }), NOW).tone).toBe('AMBER')
    expect(watchChecks(facts({ registerCheckStatus: 'RECORDED' }), NOW).tone).toBe('RED')
    // A supplier problem reaches every watch bought from them.
    expect(watchChecks(facts({ vatCheckStatus: 'NOT_FOUND' }), NOW).tone).toBe('RED')
  })

  it('names the worst thing in the summary, not the first thing', () => {
    const both = watchChecks(facts({ vatCheckStatus: 'UNCHECKED', registerCheckStatus: 'RECORDED' }), NOW)
    expect(both.tone).toBe('RED')
    expect(both.summary).toBe('On the register')
    expect(both.summary).not.toContain('Not checked')
  })

  it('names both when both are amber', () => {
    const summary = watchChecks(
      facts({ vatCheckStatus: 'UNCHECKED', registerCheckStatus: 'UNCHECKED' }),
      NOW,
    ).summary
    expect(summary).toContain('Not checked')
  })
})

describe('the arithmetic', () => {
  it('counts whole days, and nothing at all from nothing', () => {
    expect(daysSince(daysAgo(3), NOW)).toBe(3)
    expect(daysSince(null, NOW)).toBeNull()
    expect(daysSince('not a date', NOW)).toBeNull()
  })

  it('reads an ISO string as readily as a Date, because the browser gets strings', () => {
    expect(daysSince(daysAgo(5).toISOString(), NOW)).toBe(5)
  })

  it('puts the next check ninety days on', () => {
    const due = vatRecheckDueAt('2026-09-03T12:00:00Z')!
    expect(due.toISOString().slice(0, 10)).toBe('2026-12-02')
    expect(vatRecheckDueAt(null)).toBeNull()
  })

  it('ranks the tones', () => {
    expect(worstTone('GREEN', 'AMBER')).toBe('AMBER')
    expect(worstTone('RED', 'GREEN')).toBe('RED')
    expect(worstTone('AMBER', 'RED', 'GREEN')).toBe('RED')
    expect(worstTone()).toBe('GREEN')
  })
})
