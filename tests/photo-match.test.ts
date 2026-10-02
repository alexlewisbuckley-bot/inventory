import { describe, expect, it } from 'vitest'
import { matchPhoto, matchPhotos, type MatchCandidate } from '@/lib/photo-match'

/**
 * A warranty card attached to the wrong watch is a document asserting a
 * history that watch does not have. Every case here is therefore written from
 * the same question: would a person be annoyed that it guessed, or alarmed?
 * Annoyed is acceptable. Alarmed is not.
 */
const STOCK: MatchCandidate[] = [
  { id: 'w1', stockNo: '1378', serial: '466787F0' },
  { id: 'w2', stockNo: '1377', serial: '0964K236' },
  { id: 'w3', stockNo: '1376', serial: 'G696036' },
  { id: 'w4', stockNo: '1375', serial: null },      // booked in without one
  { id: 'w5', stockNo: '20260213', serial: null },  // a stock number that looks like a date
]

describe('matching a photograph to a watch', () => {
  it('matches a filename that is just the serial', () => {
    const m = matchPhoto('466787F0.jpg', STOCK)
    expect(m.watchId).toBe('w1')
    expect(m.reason).toBe('serial')
  })

  it('finds the serial appended to whatever the phone called it', () => {
    expect(matchPhoto('IMG_4821_466787F0.jpeg', STOCK).watchId).toBe('w1')
    expect(matchPhoto('20260213-0964K236-card.png', STOCK).watchId).toBe('w2')
  })

  it('ignores case and separators in the serial', () => {
    expect(matchPhoto('466787-f0.jpg', STOCK).watchId).toBe('w1')
    expect(matchPhoto('g696036.JPG', STOCK).watchId).toBe('w3')
  })

  it('falls back to the stock number when there is no serial', () => {
    const m = matchPhoto('IMG_1375.jpg', STOCK)
    expect(m.watchId).toBe('w4')
    expect(m.reason).toBe('stock number')
  })

  /**
   * The case that makes a naive matcher dangerous: every photograph off a
   * phone is a long run of digits, and a four-digit stock number appears
   * inside most of them by chance.
   */
  it('does not read a stock number out of the middle of a longer number', () => {
    const m = matchPhoto('IMG_20261378045.jpg', STOCK)
    expect(m.watchId).toBeNull()
    expect(m.note).toMatch(/no serial or stock number/i)
  })

  it('still matches a stock number that happens to look like a date', () => {
    expect(matchPhoto('IMG_20260213.jpg', STOCK).watchId).toBe('w5')
  })

  it('refuses when one serial is on more than one watch', () => {
    const duplicated: MatchCandidate[] = [
      { id: 'a', stockNo: '900', serial: 'SAME123' },
      { id: 'b', stockNo: '901', serial: 'SAME123' },
    ]
    const m = matchPhoto('SAME123.jpg', duplicated)
    expect(m.watchId).toBeNull()
    expect(m.note).toContain('900')
    expect(m.note).toContain('901')
  })

  it('refuses when the filename names two different watches', () => {
    const m = matchPhoto('1378_and_1377.jpg', STOCK)
    expect(m.watchId).toBeNull()
    expect(m.note).toMatch(/could mean/i)
  })

  it('never matches on a blank or very short serial', () => {
    const short: MatchCandidate[] = [
      { id: 'a', stockNo: '900', serial: 'A1' },
      { id: 'b', stockNo: '901', serial: '' },
      { id: 'c', stockNo: '902', serial: null },
    ]
    // "A1" appears inside this filename, and must still not be used.
    expect(matchPhoto('CARD-A1B2C3.jpg', short).watchId).toBeNull()
  })

  it('says something useful when it cannot match', () => {
    const m = matchPhoto('scan 1.jpg', STOCK)
    expect(m.watchId).toBeNull()
    expect(m.note).toBeTruthy()
  })

  it('handles a filename with no extension, and one that is only an extension', () => {
    expect(matchPhoto('466787F0', STOCK).watchId).toBe('w1')
    expect(matchPhoto('.jpg', STOCK).watchId).toBeNull()
  })

  /** The database stores the stock number as an integer, not a string. */
  it('matches a numeric stock number the same as a written one', () => {
    const numeric: MatchCandidate[] = [{ id: 'n', stockNo: 1378, serial: null }]
    expect(matchPhoto('IMG_1378.jpg', numeric).watchId).toBe('n')
    expect(matchPhoto('IMG_20261378045.jpg', numeric).watchId).toBeNull()
  })

  it('matches a whole batch, keeping the order it was given', () => {
    const out = matchPhotos(['466787F0.jpg', 'nothing.jpg', 'IMG_1375.png'], STOCK)
    expect(out.map((m) => m.watchId)).toEqual(['w1', null, 'w4'])
    expect(out.map((m) => m.file)).toEqual(['466787F0.jpg', 'nothing.jpg', 'IMG_1375.png'])
  })

  /** Front and back of the same card is normal; the grid shows it, not this. */
  it('allows two photographs to land on one watch', () => {
    const out = matchPhotos(['466787F0-front.jpg', '466787F0-back.jpg'], STOCK)
    expect(out.map((m) => m.watchId)).toEqual(['w1', 'w1'])
  })
})
