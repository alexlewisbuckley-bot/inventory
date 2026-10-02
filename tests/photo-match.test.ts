import { describe, expect, it } from 'vitest'
import { guessKind, matchPhoto, matchPhotos, rankCandidates, type MatchCandidate } from '@/lib/photo-match'

/**
 * A warranty card attached to the wrong watch is a document asserting a
 * history that watch does not have. Every case here is therefore written from
 * the same question: would a person be annoyed that it guessed, or alarmed?
 * Annoyed is acceptable. Alarmed is not.
 */
const STOCK: MatchCandidate[] = [
  { id: 'w1', stockNo: '1378', reference: '126711CHNR', serial: '466787F0' },
  { id: 'w2', stockNo: '1377', reference: '179171', serial: '0964K236' },
  { id: 'w3', stockNo: '1376', reference: '116244', serial: 'G696036' },
  { id: 'w4', stockNo: '1375', reference: '5167R', serial: null },       // booked in without one
  { id: 'w5', stockNo: '20260213', reference: '126284RBR', serial: null }, // stock number that looks like a date
]

describe('matching a photograph to a watch', () => {
  it('matches a filename that is just the serial', () => {
    const m = matchPhoto('466787F0.jpg', STOCK)
    expect(m.watchIds).toEqual(['w1'])
    expect(m.reason).toBe('serial')
    expect(m.exact).toBe(true)
  })

  it('finds the serial appended to whatever the phone called it', () => {
    expect(matchPhoto('IMG_4821_466787F0.jpeg', STOCK).watchIds).toEqual(['w1'])
    expect(matchPhoto('20260213-0964K236-card.png', STOCK).watchIds).toEqual(['w2'])
  })

  it('ignores case and separators in the serial', () => {
    expect(matchPhoto('466787-f0.jpg', STOCK).watchIds).toEqual(['w1'])
    expect(matchPhoto('g696036.JPG', STOCK).watchIds).toEqual(['w3'])
  })

  /**
   * The case this was rebuilt for. Seventy-three photographs arrived named
   * after the reference, because the reference is what is written on the
   * watch and on the bag it came in — and every one of them went unmatched.
   */
  it('matches on the reference, which is what people actually name files after', () => {
    const m = matchPhoto('5167R.png', STOCK)
    expect(m.watchIds).toEqual(['w4'])
    expect(m.reason).toBe('reference')
    expect(m.exact).toBe(true)
  })

  it('finds the reference alongside anything else in the name', () => {
    expect(matchPhoto('IMG_5167R-front.jpg', STOCK).watchIds).toEqual(['w4'])
    expect(matchPhoto('126711CHNR (2).jpeg', STOCK).watchIds).toEqual(['w1'])
  })

  /**
   * A reference is a model, not a watch. Three Lady-Datejust 179383 in stock
   * is ordinary, and one photograph called `179383.png` is a photograph of
   * all three as often as it is of one — so all of them are proposed, and
   * flagged, rather than the whole thing being refused.
   */
  it('proposes every watch with that reference, flagged for a look', () => {
    const twins: MatchCandidate[] = [
      { id: 'a', stockNo: '900', reference: '179383', serial: null },
      { id: 'b', stockNo: '901', reference: '179383', serial: null },
      { id: 'c', stockNo: '902', reference: '179383', serial: null },
    ]
    const m = matchPhoto('179383-1.jpg', twins)
    expect(m.watchIds).toEqual(['a', 'b', 'c'])
    expect(m.reason).toBe('reference')
    expect(m.exact).toBe(false)
    expect(m.note).toMatch(/untick/i)
  })

  /** A serial names one watch. Two watches sharing one is bad data, not a set. */
  it('still refuses when one serial is on more than one watch', () => {
    const duplicated: MatchCandidate[] = [
      { id: 'a', stockNo: '900', reference: '16610', serial: 'SAME123' },
      { id: 'b', stockNo: '901', reference: '214270', serial: 'SAME123' },
    ]
    const m = matchPhoto('SAME123.jpg', duplicated)
    expect(m.watchIds).toEqual([])
    expect(m.shortlist).toEqual(['a', 'b'])
  })

  /**
   * The reference field is free text and is not always only the reference:
   * real records read `Explorer II 343591`, and nobody names the file that.
   */
  it('finds the reference inside a reference written as a phrase', () => {
    const wordy: MatchCandidate[] = [
      { id: 'a', stockNo: '800', reference: 'Explorer II 343591', serial: null },
      { id: 'b', stockNo: '801', reference: 'Submariner 116610LV', serial: null },
    ]
    expect(matchPhoto('343591.jpg', wordy).watchIds).toEqual(['a'])
    expect(matchPhoto('IMG_116610LV_2.jpg', wordy).watchIds).toEqual(['b'])
  })

  /** `II`, `GMT`, `LTD`: on half the stock, so worth nothing as a key. */
  it('ignores the short words in a reference written as a phrase', () => {
    const wordy: MatchCandidate[] = [
      { id: 'a', stockNo: '800', reference: 'Explorer II 343591', serial: null },
      { id: 'b', stockNo: '801', reference: 'GMT Master II 126711', serial: null },
    ]
    expect(matchPhoto('II.jpg', wordy).watchIds).toEqual([])
    expect(matchPhoto('GMT-front.jpg', wordy).watchIds).toEqual([])
  })

  it('prefers the serial over the reference when the name carries both', () => {
    const m = matchPhoto('126711CHNR_0964K236.jpg', STOCK)
    expect(m.watchIds).toEqual(['w2'])
    expect(m.reason).toBe('serial')
  })

  it('falls back to the stock number when there is no serial', () => {
    const m = matchPhoto('IMG_1375.jpg', STOCK)
    expect(m.watchIds).toEqual(['w4'])
    expect(m.reason).toBe('stock number')
  })

  /**
   * The case that makes a naive matcher dangerous: every photograph off a
   * phone is a long run of digits, and a four-digit stock number appears
   * inside most of them by chance.
   */
  it('does not read a stock number out of the middle of a longer number', () => {
    const m = matchPhoto('IMG_20261378045.jpg', STOCK)
    expect(m.watchIds).toEqual([])
    expect(m.note).toMatch(/no serial, reference or stock number/i)
  })

  it('still matches a stock number that happens to look like a date', () => {
    expect(matchPhoto('IMG_20260213.jpg', STOCK).watchIds).toEqual(['w5'])
  })

  it('refuses when one serial is on more than one watch', () => {
    const duplicated: MatchCandidate[] = [
      { id: 'a', stockNo: '900', reference: '16610', serial: 'SAME123' },
      { id: 'b', stockNo: '901', reference: '214270', serial: 'SAME123' },
    ]
    const m = matchPhoto('SAME123.jpg', duplicated)
    expect(m.watchIds).toEqual([])
    expect(m.note).toContain('900')
    expect(m.note).toContain('901')
  })

  it('refuses when the filename names two different stock numbers', () => {
    const m = matchPhoto('1378_and_1377.jpg', STOCK)
    expect(m.watchIds).toEqual([])
    expect(m.note).toMatch(/could mean/i)
  })

  /** Nothing matched, so the picker is handed somewhere to start. */
  it('hands back a ranked shortlist when the filename named nothing', () => {
    const m = matchPhoto('Lady-Datejust spare.png', [
      ...STOCK,
      { id: 'x', stockNo: '1400', reference: '179160', serial: null, name: 'Rolex Lady-Datejust' },
    ])
    expect(m.watchIds).toEqual([])
    expect(m.shortlist).toContain('x')
  })

  it('never matches on a blank or very short serial', () => {
    const short: MatchCandidate[] = [
      { id: 'a', stockNo: '900', reference: '16610', serial: 'A1' },
      { id: 'b', stockNo: '901', reference: '214270', serial: '' },
      { id: 'c', stockNo: '902', reference: '114060', serial: null },
    ]
    // "A1" appears inside this filename, and must still not be used.
    expect(matchPhoto('CARD-A1B2C3.jpg', short).watchIds).toEqual([])
  })

  it('says something useful when it cannot match', () => {
    const m = matchPhoto('scan 1.jpg', STOCK)
    expect(m.watchIds).toEqual([])
    expect(m.note).toBeTruthy()
  })

  it('handles a filename with no extension, and one that is only an extension', () => {
    expect(matchPhoto('466787F0', STOCK).watchIds).toEqual(['w1'])
    expect(matchPhoto('.jpg', STOCK).watchIds).toEqual([])
  })

  /** The database stores the stock number as an integer, not a string. */
  it('matches a numeric stock number the same as a written one', () => {
    const numeric: MatchCandidate[] = [{ id: 'n', stockNo: 1378, reference: '5167R', serial: null }]
    expect(matchPhoto('IMG_1378.jpg', numeric).watchIds).toEqual(['n'])
    expect(matchPhoto('IMG_20261378045.jpg', numeric).watchIds).toEqual([])
  })

  it('matches a whole batch, keeping the order it was given', () => {
    const out = matchPhotos(['466787F0.jpg', 'nothing.jpg', 'IMG_1375.png'], STOCK)
    expect(out.map((m) => m.watchIds)).toEqual([['w1'], [], ['w4']])
    expect(out.map((m) => m.file)).toEqual(['466787F0.jpg', 'nothing.jpg', 'IMG_1375.png'])
  })

  /** Front and back of the same card is normal; the grid shows it, not this. */
  it('allows two photographs to land on one watch', () => {
    const out = matchPhotos(['466787F0-front.jpg', '466787F0-back.jpg'], STOCK)
    expect(out.map((m) => m.watchIds)).toEqual([['w1'], ['w1']])
  })
})

describe('offering the closest match', () => {
  it('offers the nearest reference when nothing matches outright, and flags it', () => {
    const m = matchPhoto('5167G.png', STOCK)
    expect(m.watchIds).toEqual(['w4'])
    expect(m.reason).toBe('closest reference')
    expect(m.exact).toBe(false)
    expect(m.note).toMatch(/closest match/i)
  })

  /**
   * A reference buried inside a longer word is a coincidence as often as a
   * typo, so it is offered but never claimed.
   */
  it('treats a reference inside a longer word as a guess, not a fact', () => {
    const m = matchPhoto('IMG_5167RX.jpg', STOCK)
    expect(m.watchIds).toEqual(['w4'])
    expect(m.exact).toBe(false)
  })

  /** Equally near two watches is no answer at all. */
  it('offers nothing when two references are equally close', () => {
    const pair: MatchCandidate[] = [
      { id: 'a', stockNo: '900', reference: '5167R', serial: null },
      { id: 'b', stockNo: '901', reference: '5167G', serial: null },
    ]
    const m = matchPhoto('5167P.png', pair)
    expect(m.watchIds).toEqual([])
  })

  it('does not stretch to a reference that is simply different', () => {
    expect(matchPhoto('ZZZZZZ.png', STOCK).watchIds).toEqual([])
    expect(matchPhoto('front.jpg', STOCK).watchIds).toEqual([])
  })

  /** Camera noise is not a near miss for anything. */
  it('never treats the camera prefix or a short word as a reference', () => {
    const m = matchPhoto('IMG_01.jpg', STOCK)
    expect(m.watchIds).toEqual([])
  })

  /**
   * The reason a run of digits is never offered as a near match. References
   * here are six digits and so is the time in a phone's filename, so
   * `IMG_20260213_112233` is one character away from reference 116233.
   */
  it('does not offer a watch because of what time the photograph was taken', () => {
    const numeric: MatchCandidate[] = [{ id: 'a', stockNo: '800', reference: '116233', serial: null }]
    expect(matchPhoto('IMG_20260213_112233.jpg', numeric).watchIds).toEqual([])
    expect(matchPhoto('IMG_20260213_112233.jpg', numeric).exact).toBe(false)
    // The reference spelled correctly still matches, exactly.
    expect(matchPhoto('IMG_20260213_116233.jpg', numeric).watchIds).toEqual(['a'])
  })
})

describe('guessing what an image is of', () => {
  it('reads the filename for a card or a document', () => {
    expect(guessKind('5167R-warranty.jpg')).toBe('CARD')
    expect(guessKind('IMG_01_card.png')).toBe('CARD')
    expect(guessKind('5167R-guarantee-cert.jpg')).toBe('CARD')
    expect(guessKind('5167R invoice.pdf.jpg')).toBe('DOCUMENT')
    expect(guessKind('service-papers-5167R.png')).toBe('DOCUMENT')
  })

  it('assumes a photograph of the watch otherwise', () => {
    expect(guessKind('5167R.png')).toBe('WATCH')
    expect(guessKind('IMG_4821.jpeg')).toBe('WATCH')
  })
})

/**
 * Refusing to guess is right. Refusing to guess and then handing somebody
 * forty watches in stock-number order has moved the work rather than done it,
 * so the filename is used a second time — not to decide, but to order.
 */
describe('shortlisting what a filename probably means', () => {
  const SHOP: MatchCandidate[] = [
    { id: 'a', stockNo: '1405', reference: '326935', serial: null, name: 'Rolex Sky-Dweller' },
    { id: 'b', stockNo: '1410', reference: '336934', serial: null, name: 'Rolex Sky-Dweller' },
    { id: 'c', stockNo: '1411', reference: '128238', serial: '7416L8L7', name: 'Rolex Day-Date Masterpiece' },
    { id: 'd', stockNo: '1412', reference: '26530ST', serial: null, name: 'Audemars Piguet Royal Oak Concept' },
    { id: 'e', stockNo: '1429', reference: '179174', serial: null, name: 'Rolex Lady-Datejust' },
  ]

  it('puts the reference one character out at the top', () => {
    const [first] = rankCandidates('336938.png', SHOP)
    expect(first?.candidate.id).toBe('b')
  })

  it('shortlists on what the watch is called, not only its reference', () => {
    expect(rankCandidates('Day-Date Masterpiece.png', SHOP)[0]?.candidate.id).toBe('c')
    expect(rankCandidates('RO Concept.png', SHOP)[0]?.candidate.id).toBe('d')
  })

  /** Two words agreeing beats one word agreeing. */
  it('prefers the watch that answers to more of the filename', () => {
    const ranked = rankCandidates('Rolex Lady-Datejust.png', SHOP)
    expect(ranked[0]?.candidate.id).toBe('e')
  })

  it('offers nothing for a filename that only describes the photograph', () => {
    expect(rankCandidates('IMG_front.jpg', SHOP)).toEqual([])
    expect(rankCandidates('WhatsApp Image 2026-09-30.jpeg', SHOP)).toEqual([])
    expect(rankCandidates('warranty card back.png', SHOP)).toEqual([])
  })

  /** The same ranking powers the search box, so a serial has to work too. */
  it('finds a watch by serial, by name and by stock number', () => {
    expect(rankCandidates('7416L8L7', SHOP)[0]?.candidate.id).toBe('c')
    expect(rankCandidates('lady', SHOP)[0]?.candidate.id).toBe('e')
    expect(rankCandidates('1412', SHOP)[0]?.candidate.id).toBe('d')
  })

  it('keeps the shortlist short', () => {
    expect(rankCandidates('Rolex', SHOP, 2).length).toBeLessThanOrEqual(2)
  })

  it('never offers a watch that resembles nothing in the name', () => {
    expect(rankCandidates('ZZZZZZZZ.png', SHOP)).toEqual([])
  })
})
