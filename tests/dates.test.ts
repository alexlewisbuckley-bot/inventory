import { describe, it, expect } from 'vitest'
import { relativeTime, daysHeld } from '@/lib/dates'

describe('relativeTime', () => {
  it('reads as "Just now" inside the last few seconds', () => {
    expect(relativeTime(new Date())).toBe('Just now')
    expect(relativeTime(new Date(Date.now() - 3_000))).toBe('Just now')
  })

  it('falls back to a distance once it is worth stating', () => {
    expect(relativeTime(new Date(Date.now() - 90_000))).toBe('2 minutes ago')
  })

  it('returns the fallback for nothing rather than an invalid date', () => {
    expect(relativeTime(null)).toBe('—')
    expect(relativeTime(undefined, 'Never')).toBe('Never')
    expect(relativeTime('not a date', 'Never')).toBe('Never')
  })
})

describe('daysHeld', () => {
  it('never reports a negative number for a future purchase date', () => {
    expect(daysHeld(new Date(Date.now() + 86_400_000))).toBe(0)
  })
})
