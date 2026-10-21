import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { postFilename, postTitle, whatsappPost } from '@/lib/whatsapp-post'
import { can } from '@/lib/permissions'
import { ROLES } from '@/lib/enums'

/**
 * `model` holds the reference number and `nickname` holds the name. Every
 * fixture here is built that way round on purpose, because getting it
 * backwards is the one mistake that would make every post wrong.
 */
const HULK = {
  brandName: 'Rolex',
  model: '116610LV',
  nickname: 'Submariner Date 40',
  year: 2018,
}

describe('what a dealer group is sent', () => {
  it('leads with the brand and the family, then the facts', () => {
    expect(whatsappPost(HULK, { tradePrice: 'AED 48,500' })).toBe(
      'Rolex Submariner Date 40\nRef: 116610LV\nYear: 2018\nTrade: AED 48,500',
    )
  })

  it('never says the brand twice', () => {
    // A nickname carrying the brand is common and would otherwise read
    // "Rolex Rolex Datejust 41".
    expect(postTitle({ ...HULK, nickname: 'Rolex Datejust 41' })).toBe('Rolex Datejust 41')
  })

  it('keeps the case size, which a shop menu would drop', () => {
    // familyOf() strips it to group a menu. To a dealer a 41 and a 36 are
    // different watches at different money, so it stays.
    expect(postTitle({ ...HULK, nickname: 'Datejust 41' })).toBe('Rolex Datejust 41')
    expect(postTitle({ ...HULK, nickname: 'Datejust 36' })).toBe('Rolex Datejust 36')
  })

  it('falls back to the brand alone when there is no name', () => {
    expect(postTitle({ ...HULK, nickname: null })).toBe('Rolex')
    // The reference still carries the identification on its own line.
    expect(whatsappPost({ ...HULK, nickname: null }, { tradePrice: null }))
      .toBe('Rolex\nRef: 116610LV\nYear: 2018')
  })

  it('leaves out a field rather than sending a blank one', () => {
    const post = whatsappPost({ ...HULK, year: null }, { tradePrice: null })
    expect(post).not.toMatch(/Year/)
    expect(post).not.toMatch(/Trade/)
    // An em dash in a WhatsApp message reads as a mistake, not an absence.
    expect(post).not.toContain('—')
  })

  it('omits the price on an unpriced watch rather than implying it is free', () => {
    expect(whatsappPost(HULK, { tradePrice: null })).not.toMatch(/Trade/)
  })

  it('stays short enough to read in a scrolling group', () => {
    const post = whatsappPost(HULK, { tradePrice: 'AED 48,500' })
    expect(post.split('\n')).toHaveLength(4)
    // WhatsApp collapses a long message behind "Read more", where it goes
    // unread. Nothing here should come close.
    expect(post.length).toBeLessThan(120)
  })

  it('carries no markdown, because WhatsApp does not render it', () => {
    const post = whatsappPost(HULK, { tradePrice: 'AED 48,500' })
    expect(post).not.toMatch(/[#*_`|]/)
  })

  it('names the downloaded photograph after the watch', () => {
    expect(postFilename(HULK, 'image/jpeg')).toBe('Rolex-116610LV.jpg')
    expect(postFilename(HULK, 'image/png')).toBe('Rolex-116610LV.png')
    // Anything that cannot sit in a filename is dropped, not escaped.
    expect(postFilename({ ...HULK, model: 'REF/22 "A"' }, 'image/jpeg'))
      .toBe('Rolex-REF-22-A.jpg')
  })
})

describe('only the owner may broadcast', () => {
  it('grants watch:broadcast to the owner and nobody else', () => {
    const holders = ROLES.filter((role) => can(role, 'watch:broadcast'))
    expect(holders).toEqual(['OWNER'])
  })

  it('is not implied by reading a watch or its price', () => {
    // A manager runs the stock and may see the trade figure. Posting it into
    // a forwardable group chat is a separate decision.
    expect(can('MANAGER', 'watch:read')).toBe(true)
    expect(can('MANAGER', 'watch:price')).toBe(true)
    expect(can('MANAGER', 'watch:broadcast')).toBe(false)
    expect(can('SALES', 'watch:broadcast')).toBe(false)
  })
})

describe('the record page gates and feeds the button', () => {
  const page = readFileSync('src/app/(app)/inventory/[id]/page.tsx', 'utf8')

  it('renders it behind the capability', () => {
    expect(page).toMatch(/can\(user\.role, 'watch:broadcast'\) && \(/)
  })

  it('prices it in dirhams, not in whatever the reader prefers', () => {
    // The message goes to a dealer group in Dubai. The viewer's display
    // currency is about this screen and has no business in it.
    expect(page).toMatch(/formatBase\(watch\.tradePriceGbp, BASE_CURRENCY, rates\)/)
  })

  it('never sends a warranty card or a document', () => {
    // Both carry a serial and a dealer stamp, and the message can be
    // forwarded on by anybody who receives it.
    expect(page).toMatch(/images\.find\(\(image\) => image\.kind === 'WATCH'\)/)
    expect(page).toMatch(/images\.find\(\(image\) => image\.kind === 'TRADE'\)/)
    expect(page).not.toMatch(/kind === 'CARD'/)
    expect(page).not.toMatch(/kind === 'DOCUMENT'/)
  })
})
