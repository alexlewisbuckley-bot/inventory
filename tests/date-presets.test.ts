import { describe, it, expect } from 'vitest'
import { matchPreset, presetRange } from '@/lib/date-presets'

// 5 Nov 2026, midday in Dubai.
const NOW = new Date('2026-11-05T08:00:00Z')

describe('presetRange', () => {
  it('covers this month up to today', () => {
    expect(presetRange('this-month', NOW)).toEqual({ from: '2026-11-01', to: '2026-11-05' })
  })

  it('covers the whole of last month', () => {
    expect(presetRange('last-month', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(presetRange('last-month', new Date('2026-01-10T08:00:00Z')))
      .toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('rolls back three and six months from today', () => {
    expect(presetRange('last-3-months', NOW)).toEqual({ from: '2026-08-05', to: '2026-11-05' })
    expect(presetRange('last-6-months', NOW)).toEqual({ from: '2026-05-05', to: '2026-11-05' })
  })

  it('clamps to the end of a shorter month', () => {
    expect(presetRange('last-3-months', new Date('2026-05-31T08:00:00Z')))
      .toEqual({ from: '2026-02-28', to: '2026-05-31' })
  })

  it('covers year to date and last year', () => {
    expect(presetRange('ytd', NOW)).toEqual({ from: '2026-01-01', to: '2026-11-05' })
    expect(presetRange('last-year', NOW)).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })

  it('uses the Dubai date, not UTC', () => {
    // 21:00 UTC on 31 Oct is already 1 Nov in Dubai.
    expect(presetRange('this-month', new Date('2026-10-31T21:00:00Z')))
      .toEqual({ from: '2026-11-01', to: '2026-11-01' })
  })
})

describe('matchPreset', () => {
  it('recognises a range a preset produced', () => {
    expect(matchPreset('2026-01-01', '2026-11-05', NOW)).toBe('ytd')
    expect(matchPreset('2026-10-01', '2026-10-31', NOW)).toBe('last-month')
  })

  it('returns null for a hand-picked or open range', () => {
    expect(matchPreset('2026-10-02', '2026-10-31', NOW)).toBeNull()
    expect(matchPreset('2026-10-01', '', NOW)).toBeNull()
  })
})
