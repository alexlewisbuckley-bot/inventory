import { describe, expect, it } from 'vitest'
import { deliveryDays, deliveryLine, dubaiToday, noteWithDelivery } from '@/lib/delivery'

const TODAY = '2026-11-15'

describe('delivery on a portal order', () => {
  it('offers the next two weeks from tomorrow', () => {
    const days = deliveryDays(TODAY)
    expect(days).toHaveLength(14)
    expect(days[0]).toBe('2026-11-16')
    expect(days.at(-1)).toBe('2026-11-29')
  })

  it('writes the day and window in plain words', () => {
    expect(deliveryLine('2026-11-18', 'MIDDAY', TODAY))
      .toBe('Delivery: Wednesday 18 November 2026, 12:00–15:00 (Midday)')
    expect(deliveryLine('2026-11-18', '', TODAY))
      .toBe('Delivery: Wednesday 18 November 2026, any time')
  })

  it('drops a day that is today, past, too far out, or not a date', () => {
    expect(deliveryLine('2026-11-15', 'MORNING', TODAY)).toBeNull()
    expect(deliveryLine('2026-11-01', 'MORNING', TODAY)).toBeNull()
    expect(deliveryLine('2027-03-01', 'MORNING', TODAY)).toBeNull()
    expect(deliveryLine('next tuesday', 'MORNING', TODAY)).toBeNull()
    expect(deliveryLine(null, null, TODAY)).toBeNull()
  })

  it('puts the delivery above what they typed', () => {
    expect(noteWithDelivery('Ring the bell', 'Delivery: X')).toBe('Delivery: X\nRing the bell')
    expect(noteWithDelivery('', 'Delivery: X')).toBe('Delivery: X')
    expect(noteWithDelivery('  ', null)).toBeNull()
    expect(noteWithDelivery('Just this', null)).toBe('Just this')
  })

  it('counts the day in Dubai, not UTC', () => {
    // 22:00 UTC on the 15th is already the 16th in Dubai.
    expect(dubaiToday(new Date('2026-11-15T22:00:00Z'))).toBe('2026-11-16')
  })
})
