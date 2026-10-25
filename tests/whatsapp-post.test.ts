import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { pickPostImage, postFilename, postTitle, whatsappPost } from '@/lib/whatsapp-post'
import { can } from '@/lib/permissions'
import { ROLES } from '@/lib/enums'

/**
 * `model` holds the reference number and `model name` holds the name. Every
 * fixture here is built that way round on purpose, because getting it
 * backwards is the one mistake that would make every post wrong.
 */
const HULK = {
  brandName: 'Rolex',
  model: '116610LV',
  modelName: 'Submariner Date 40',
  year: 2018,
}

describe('what a dealer group is sent', () => {
  it('leads with the brand and the family, then the facts', () => {
    expect(whatsappPost(HULK, { tradePrice: 'AED 48,500' })).toBe(
      'Rolex Submariner Date 40\nRef: 116610LV\nYear: 2018\nTrade: AED 48,500',
    )
  })

  it('never says the brand twice', () => {
    // A model name carrying the brand is common and would otherwise read
    // "Rolex Rolex Datejust 41".
    expect(postTitle({ ...HULK, modelName: 'Rolex Datejust 41' })).toBe('Rolex Datejust 41')
  })

  it('keeps the case size, which a shop menu would drop', () => {
    // familyOf() strips it to group a menu. To a dealer a 41 and a 36 are
    // different watches at different money, so it stays.
    expect(postTitle({ ...HULK, modelName: 'Datejust 41' })).toBe('Rolex Datejust 41')
    expect(postTitle({ ...HULK, modelName: 'Datejust 36' })).toBe('Rolex Datejust 36')
  })

  it('falls back to the brand alone when there is no name', () => {
    expect(postTitle({ ...HULK, modelName: null })).toBe('Rolex')
    // The reference still carries the identification on its own line.
    expect(whatsappPost({ ...HULK, modelName: null }, { tradePrice: null }))
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
    expect(page).toMatch(/can\(user\.role, 'watch:broadcast'\) &&/)
  })

  it('prices it in dirhams, not in whatever the reader prefers', () => {
    // The message goes to a dealer group in Dubai. The viewer's display
    // currency is about this screen and has no business in it.
    expect(page).toMatch(/formatBase\(watch\.tradePriceGbp, BASE_CURRENCY, rates\)/)
  })

  it('picks the photograph through the shared rule', () => {
    // One rule, so the record and the drawer cannot disagree about which
    // picture goes out.
    expect(page).toMatch(/pickPostImage\(images\)/)
  })
})

describe('two machines, two ways of handing it over', () => {
  const component = readFileSync('src/components/inventory/WhatsAppPost.tsx', 'utf8')

  it('uses the share sheet when the browser has one', () => {
    // The phone path: one tap, image with the text as its caption.
    expect(component).toMatch(/navigator\.share\(\{ files: \[file\], text: message \}\)/)
    // Asked with the actual file — a browser can share text and refuse files.
    expect(component).toMatch(/navigator\.canShare\?\.\(\{ files: \[file\] \}\)/)
  })

  it('re-encodes to PNG before putting a photo on the clipboard', () => {
    // A watch photograph is a JPEG and every browser refuses to clipboard
    // anything but PNG, so handing the blob over unchanged always fails.
    expect(component).toMatch(/toBlob\(.*'image\/png'\)/s)
    expect(component).toMatch(/new ClipboardItem\(\{ 'image\/png': await toPng\(file\) \}\)/)
  })

  it('never tries to put the photo and the caption on the clipboard at once', () => {
    // The trap this whole component exists to avoid: WhatsApp would pick the
    // image and the reference and price would vanish without a word.
    expect(component).not.toMatch(/ClipboardItem\(\{[^}]*image\/png[^}]*text\/plain/s)
  })

  it('treats a dismissed share sheet as a change of mind, not a failure', () => {
    expect(component).toMatch(/AbortError/)
  })

  it('shows the message, so nobody pastes something they have not read', () => {
    // It rides on the toast now that the panel is gone — same guarantee,
    // without a screen to dismiss first.
    expect(component).toMatch(/description: message/)
  })
})

describe('the share sheet is only used where WhatsApp is in it', () => {
  const component = readFileSync('src/components/inventory/WhatsAppPost.tsx', 'utf8')

  it('requires a touch device, not merely a browser that can share', () => {
    // macOS has a share sheet and will take the file, but WhatsApp Desktop
    // does not register as a share target — the sheet opens onto AirDrop,
    // Mail and Notes, with the caption dropped. Asking canShare() alone sent
    // every Mac down a path that could not reach WhatsApp.
    expect(component).toMatch(/isTouchDevice\(\) && typeof navigator\.share === 'function'/)
  })

  it('decides by pointer type rather than sniffing the user agent', () => {
    expect(component).toMatch(/matchMedia\('\(pointer: coarse\)'\)\.matches/)
    expect(component).not.toMatch(/userAgent/)
  })

  it('guards against matchMedia being absent before calling it', () => {
    expect(component).toMatch(/typeof window\.matchMedia !== 'function'\) return false/)
  })
})

describe('which photograph goes out', () => {
  const trade = { id: 'img_trade', kind: 'TRADE' }
  const shot = { id: 'img_watch', kind: 'WATCH' }
  const card = { id: 'img_card', kind: 'CARD' }
  const doc = { id: 'img_doc', kind: 'DOCUMENT' }

  it('prefers the trade shot — the one prepared for sending', () => {
    expect(pickPostImage([shot, trade])).toBe('img_trade')
    expect(pickPostImage([trade, shot])).toBe('img_trade')
  })

  it('falls back to the watch shot when there is no trade shot', () => {
    expect(pickPostImage([shot])).toBe('img_watch')
  })

  it('never sends a warranty card or a document', () => {
    // Both carry a serial, a date and a dealer's stamp, and this message can
    // be forwarded on by anybody who receives it.
    expect(pickPostImage([card, doc])).toBeNull()
    expect(pickPostImage([card, doc, shot])).toBe('img_watch')
  })

  it('returns null for a watch with no photographs', () => {
    expect(pickPostImage([])).toBeNull()
  })
})

describe('one click, not a panel', () => {
  const component = readFileSync('src/components/inventory/WhatsAppPost.tsx', 'utf8')

  it('no longer opens a modal to walk somebody through it', () => {
    // Speed is the whole point: a panel with two buttons was two clicks and
    // two pastes before anything reached a group.
    expect(component).not.toMatch(/<Modal/)
  })

  it('offers the caption on the toast rather than as a required step', () => {
    expect(component).toMatch(/label: 'Copy caption'/)
  })

  it('still puts the words somewhere when the photo copy fails', () => {
    // Failing silently would leave somebody pasting nothing into a group.
    expect(component).toMatch(/clipboard\.writeText\(message\)/)
  })
})

describe('the drawer can post without opening the record', () => {
  const drawer = readFileSync('src/components/inventory/WatchDrawerClient.tsx', 'utf8')
  const server = readFileSync('src/components/inventory/WatchDrawer.tsx', 'utf8')

  it('renders the button behind the owner capability', () => {
    expect(drawer).toMatch(/capabilities\['watch:broadcast'\] &&/)
    expect(drawer).toMatch(/<WhatsAppPost/)
  })

  it('is handed the name and the trade price it needs', () => {
    // Neither was on the drawer record before; without them the post would
    // have shown the brand alone and no price.
    expect(server).toMatch(/modelName: record\.watch\.modelName/)
    expect(server).toMatch(/tradePriceGbp: record\.watch\.tradePriceGbp/)
  })

  it('prices it in dirhams rather than the viewer\'s display currency', () => {
    expect(drawer).toMatch(/formatCurrency\(record\.tradePriceGbp, BASE_CURRENCY\)/)
  })

  it('uses the same photograph rule as the record', () => {
    expect(drawer).toMatch(/pickPostImage\(images\)/)
  })
})

describe('a sold watch is not offered to a group', () => {
  const drawer = readFileSync('src/components/inventory/WatchDrawerClient.tsx', 'utf8')
  const page = readFileSync('src/app/(app)/inventory/[id]/page.tsx', 'utf8')

  it('hides the button once the watch is gone', () => {
    // Posting a sold piece at a trade price into a dealer group is the kind
    // of mistake the application should not make easy.
    expect(drawer).toMatch(/capabilities\['watch:broadcast'\] && !sold/)
    expect(page).toMatch(/can\(user\.role, 'watch:broadcast'\) && watch\.status !== 'SOLD'/)
  })
})
