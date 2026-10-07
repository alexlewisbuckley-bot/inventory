import { describe, expect, it } from 'vitest'
import { isUploadableImage, looksLikeHeic } from '@/lib/downscale'

/**
 * An iPhone photograph, arriving the way they actually arrive.
 *
 * HEIC has been the default on every iPhone since 2017, so a photograph
 * AirDropped off a phone is one. Three separate things refused it and none of
 * them said so: the file picker's `accept` list left it greyed out, the drop
 * zones filtered on `type.startsWith('image/')` and threw it away, and the
 * server allowed only JPEG, PNG and WebP.
 *
 * The middle one is the reason nothing appeared to happen at all. A file that
 * comes over AirDrop, or is dragged out of Photos, very often reaches the
 * browser with `type` set to the empty string — so the test that was meant to
 * keep spreadsheets out of a photo drop was discarding the commonest kind of
 * photograph there is, silently, before anything could convert it.
 */
const file = (name: string, type = '') => ({ name, type })

describe('recognising an iPhone photograph', () => {
  it('knows one by its type', () => {
    expect(looksLikeHeic(file('IMG_4821.HEIC', 'image/heic'))).toBe(true)
    expect(looksLikeHeic(file('IMG_4821.heif', 'image/heif'))).toBe(true)
    // Safari reports a sequence as its own type.
    expect(looksLikeHeic(file('IMG_4821.heic', 'image/heic-sequence'))).toBe(true)
  })

  it('knows one by its name when the browser says nothing', () => {
    // This is the case that mattered: AirDrop hands over no type at all.
    expect(looksLikeHeic(file('IMG_4821.HEIC'))).toBe(true)
    expect(looksLikeHeic(file('IMG_4821.heic'))).toBe(true)
    expect(looksLikeHeic(file('1143-trade.heif'))).toBe(true)
  })

  it('does not mistake anything else for one', () => {
    expect(looksLikeHeic(file('IMG_4821.jpg', 'image/jpeg'))).toBe(false)
    expect(looksLikeHeic(file('stock.csv', 'text/csv'))).toBe(false)
    expect(looksLikeHeic(file('invoice.pdf', 'application/pdf'))).toBe(false)
    // The word in the middle of a name is not the format.
    expect(looksLikeHeic(file('heic-conversion-notes.txt', 'text/plain'))).toBe(false)
  })
})

describe('what a photo drop zone accepts', () => {
  it('takes the formats it always took', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(isUploadableImage(file('photo', type)), type).toBe(true)
    }
  })

  it('takes an iPhone photograph with no type on it', () => {
    expect(isUploadableImage(file('IMG_4821.HEIC'))).toBe(true)
  })

  it('still keeps out what is not a photograph', () => {
    expect(isUploadableImage(file('stock.xlsx', 'application/vnd.ms-excel'))).toBe(false)
    expect(isUploadableImage(file('invoice.pdf', 'application/pdf'))).toBe(false)
    expect(isUploadableImage(file('notes.txt', 'text/plain'))).toBe(false)
    // A file with no name and no type is not a photograph by default.
    expect(isUploadableImage(file(''))).toBe(false)
  })
})
