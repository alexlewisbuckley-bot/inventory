import { describe, expect, it } from 'vitest'
import { photographName, photographStem } from '@/lib/photo-name'

/**
 * What a photograph is called once it leaves.
 *
 * Off a phone they are IMG_2841 through IMG_2921 — eighty in a row whose
 * names say nothing about which watch is in them. Inside the system that does
 * not matter, because the photograph is attached to its watch. On a dealer's
 * drive the filename is all that is left of the connection.
 */
const name = (over: Partial<Parameters<typeof photographName>[0]> = {}) => photographName({
  serial: '0SQ84951', stockNo: 1143, index: 0, total: 1, mimeType: 'image/jpeg', ...over,
})

describe('the stem of the name', () => {
  it('is the serial', () => {
    expect(photographStem('0SQ84951', 1143)).toBe('0SQ84951')
  })

  it('takes out what a filename cannot carry', () => {
    // Serials are stamped alphanumerics but get typed with spaces, and one
    // with a slash in it becomes a directory on the way out.
    expect(photographStem(' 0SQ 84951 ', 1143)).toBe('0SQ84951')
    expect(photographStem('466787/F0', 1143)).toBe('466787F0')
  })

  it('reads as a serial however it was typed', () => {
    expect(photographStem('g696036', 1143)).toBe('G696036')
  })

  it('falls back to something that is obviously not a serial', () => {
    // A watch booked in before its serial was read still has photographs.
    // "stock-1143" cannot be mistaken for a serial, which is the point.
    for (const missing of [null, undefined, '', '   ', '—']) {
      expect(photographStem(missing, 1143), String(missing)).toBe('stock-1143')
    }
  })
})

describe('the filename', () => {
  it('is the serial and nothing else when there is one photograph', () => {
    expect(name()).toBe('0SQ84951.jpg')
  })

  it('numbers from the second, not the first', () => {
    // 0SQ84951.jpg and 0SQ84951-2.jpg read as a piece and its second angle.
    // 0SQ84951-1.jpg reads as the first of a set you have to go and find.
    expect(name({ index: 0, total: 3 })).toBe('0SQ84951.jpg')
    expect(name({ index: 1, total: 3 })).toBe('0SQ84951-2.jpg')
    expect(name({ index: 2, total: 3 })).toBe('0SQ84951-3.jpg')
  })

  it('keeps the format it was stored in', () => {
    expect(name({ mimeType: 'image/png' })).toBe('0SQ84951.png')
    expect(name({ mimeType: 'image/webp' })).toBe('0SQ84951.webp')
    // An iPhone photograph is converted to JPEG on upload, so a HEIC never
    // reaches here — but an unknown type should still download openable.
    expect(name({ mimeType: 'image/heic' })).toBe('0SQ84951.jpg')
  })

  it('still names a photograph of a watch with no serial', () => {
    expect(name({ serial: null })).toBe('stock-1143.jpg')
    expect(name({ serial: null, index: 1, total: 2 })).toBe('stock-1143-2.jpg')
  })
})
