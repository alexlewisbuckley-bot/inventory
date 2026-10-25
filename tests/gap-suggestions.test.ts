import { describe, expect, it } from 'vitest'
import { familyOf } from '@/lib/shopify-map'
import {
  acceptProposals,
  gapsOf,
  knownFamily,
  nicknameFrom,
  sameReference,
  storable,
  suggestFromBook,
  unresolved,
  type GapField,
  type GapRow,
  type Proposal,
} from '@/lib/gap-suggestions'

const watch = (over: Partial<GapRow> & Pick<GapRow, 'id' | 'stockNo' | 'model'>): GapRow => ({
  brandName: 'Rolex',
  modelName: null,
  caseSizeMm: null,
  ...over,
})

describe('which gaps are worth proposing an answer for', () => {
  it('asks for a model name and a size when neither is recorded', () => {
    expect(gapsOf(watch({ id: 'a', stockNo: 1, model: '126334' }))).toEqual(['modelName', 'caseSizeMm'])
  })

  it('asks for nothing once both are there', () => {
    const filled = watch({ id: 'a', stockNo: 1, model: '126334', modelName: 'Datejust 41', caseSizeMm: 41 })
    expect(gapsOf(filled)).toEqual([])
  })

  it('reads the size out of the modelName, like the card does', () => {
    // "Datejust 41" carries its own size, so this watch is not missing one
    // even with caseSizeMm empty — sizeOf finds it, and so must this.
    const named = watch({ id: 'a', stockNo: 1, model: '126334', modelName: 'Datejust 41' })
    expect(gapsOf(named)).toEqual([])
  })

  it('never proposes a dial, whatever is missing', () => {
    // A reference settles the model and the size and does not settle the
    // dial: 126334 is blue, silver, green and five others. The field is
    // deliberately outside this feature.
    const bare = watch({ id: 'a', stockNo: 1, model: '126334' })
    expect(gapsOf(bare)).not.toContain('dial')
  })
})

describe('matching a reference the way a dealer writes it', () => {
  it('ignores case and punctuation', () => {
    expect(sameReference('116610LV', '116610lv')).toBe(true)
    expect(sameReference('5740/1G-001', '5740 1G 001')).toBe(true)
  })

  it('does not match two blanks to each other', () => {
    // Every watch with no reference would otherwise become every other
    // one's evidence, which is the worst possible suggestion.
    expect(sameReference('', '')).toBe(false)
    expect(sameReference(null, null)).toBe(false)
  })

  it('keeps different references apart', () => {
    expect(sameReference('126334', '126331')).toBe(false)
  })
})

describe('answering from the book', () => {
  const held = [
    watch({ id: 'a', stockNo: 1534, model: '126334', modelName: 'Datejust 41', caseSizeMm: 41 }),
    watch({ id: 'b', stockNo: 1535, model: '126334', modelName: 'Datejust 41', caseSizeMm: 41 }),
    watch({ id: 'c', stockNo: 1588, model: '126334' }),
  ]

  it('fills a blank from the watches that share its reference', () => {
    const out = suggestFromBook(held).filter((s) => s.watchId === 'c')
    expect(out.map((s) => [s.field, s.value])).toEqual([
      ['modelName', 'Datejust 41'],
      ['caseSizeMm', '41'],
    ])
    expect(out.every((s) => s.source === 'book')).toBe(true)
  })

  it('cites the stock numbers it learned from', () => {
    // The evidence is the point. A suggestion somebody cannot check is a
    // guess with a tick box next to it.
    const [first] = suggestFromBook(held).filter((s) => s.watchId === 'c')
    expect(first.evidence).toContain('1534')
    expect(first.evidence).toContain('1535')
  })

  it('says nothing about a reference the book has not held before', () => {
    const lonely = [watch({ id: 'x', stockNo: 1573, model: '86348SAJOR' })]
    expect(suggestFromBook(lonely)).toEqual([])
  })

  it('stays silent where the watches sharing a reference disagree', () => {
    // One of the two is wrong. Picking the more popular spelling would hide
    // that; leaving it blank keeps it on the worklist where it belongs.
    const split = [
      watch({ id: 'a', stockNo: 1, model: '116610LV', modelName: 'Submariner Date', caseSizeMm: 40 }),
      watch({ id: 'b', stockNo: 2, model: '116610LV', modelName: 'Submariner Hulk', caseSizeMm: 40 }),
      watch({ id: 'c', stockNo: 3, model: '116610LV' }),
    ]
    const out = suggestFromBook(split).filter((s) => s.watchId === 'c')
    // The size is unanimous and still offered; only the disputed field drops.
    expect(out.map((s) => s.field)).toEqual(['caseSizeMm'])
  })

  it('does not quote a watch back to itself', () => {
    const alone = [watch({ id: 'a', stockNo: 1, model: '126334', modelName: 'Datejust 41' })]
    expect(suggestFromBook(alone)).toEqual([])
  })

  it('leaves a watch alone when only its other field is missing', () => {
    const rows = [
      watch({ id: 'a', stockNo: 1, model: '126334', modelName: 'Datejust 41', caseSizeMm: 41 }),
      watch({ id: 'b', stockNo: 2, model: '126334', caseSizeMm: 41 }),
    ]
    const out = suggestFromBook(rows).filter((s) => s.watchId === 'b')
    expect(out.map((s) => s.field)).toEqual(['modelName'])
  })
})

describe('what is left for Claude', () => {
  it('passes on only the gaps the book could not answer', () => {
    const rows = [
      watch({ id: 'a', stockNo: 1534, model: '126334', modelName: 'Datejust 41', caseSizeMm: 41 }),
      watch({ id: 'b', stockNo: 1588, model: '126334' }),
      watch({ id: 'c', stockNo: 1573, model: '86348SAJOR' }),
    ]
    const left = unresolved(rows, suggestFromBook(rows))
    expect(left.map((entry) => entry.row.stockNo)).toEqual([1573])
    expect(left[0].fields).toEqual(['modelName', 'caseSizeMm'])
  })
})

describe('only offering a size the shop can store', () => {
  const choices = { case_size: ['26mm', '40mm', '41mm', '44mm'] }

  it('offers a size the shop has an entry for', () => {
    expect(storable('41', 'caseSizeMm', choices)).toBe(true)
  })

  it('withholds one it has not', () => {
    // The push will not create a case size, so accepting 39 here would
    // change the record and leave the card exactly as it was.
    expect(storable('39', 'caseSizeMm', choices)).toBe(false)
  })

  it('never withholds a model name on these grounds', () => {
    expect(storable('Pearlmaster', 'modelName', choices)).toBe(true)
  })

  it('offers everything when the shop could not be read', () => {
    // An unreachable shop is not evidence that the size is missing, and
    // withholding every suggestion because Shopify is down is the wrong
    // failure. The push would skip an unmatched size anyway.
    expect(storable('39', 'caseSizeMm', {})).toBe(true)
  })
})

describe('composing a modelName from a family the shop knows', () => {
  it('puts the size on, to the convention the book uses', () => {
    expect(nicknameFrom('Datejust', 41)).toBe('Datejust 41')
  })

  it('does not give a family its size twice', () => {
    // The shop holds both "Datejust" and "Datejust 31". Pairing the latter
    // with 31mm must not write "Datejust 31 31".
    expect(nicknameFrom('Datejust 31', 31)).toBe('Datejust 31')
  })

  it('leaves a numeral that is a series, not a measurement', () => {
    expect(nicknameFrom('Datejust II', 41)).toBe('Datejust II 41')
    expect(nicknameFrom('Yacht-Master II', 42)).toBe('Yacht-Master II 42')
  })

  it('leaves a reference-shaped name alone when no size is known', () => {
    expect(nicknameFrom('RM 67', null)).toBe('RM 67')
  })

  it('reads back through familyOf to the family it started from', () => {
    // The round trip that matters: what is written here must be what the
    // card and the push read out again.
    const written = nicknameFrom('Lady-Datejust', 28)
    expect(familyOf({ modelName: written })).toBe('Lady-Datejust')
  })
})

describe('refusing a family the shop does not have', () => {
  const choices = { model: ['Datejust', 'Daytona', 'Lady-Datejust', 'Yacht-Master'] }

  it('accepts one off the list', () => {
    expect(knownFamily('Daytona', choices)).toBe(true)
  })

  it('accepts it however it is punctuated or cased', () => {
    expect(knownFamily('lady datejust', choices)).toBe(true)
  })

  it('refuses an invented one, however plausible', () => {
    // The whole guarantee. A model under pressure to be helpful will produce
    // a confident family for a reference it does not know; this is what stops
    // that reaching the worklist.
    expect(knownFamily('Submariner Professional', choices)).toBe(false)
  })

  it('refuses an empty answer', () => {
    expect(knownFamily('', choices)).toBe(false)
    expect(knownFamily('   ', choices)).toBe(false)
  })

  it('refuses everything when the shop list could not be read', () => {
    // Unlike a case size, a model name with nothing to check it against is
    // exactly the unverified guess this feature exists to avoid. Here an
    // unreadable shop means no suggestions, not unchecked ones.
    expect(knownFamily('Daytona', {})).toBe(false)
  })
})

describe('what is accepted from Claude', () => {
  const choices = {
    model: ['Daytona', 'Submariner Date "Hulk"', 'Lady-Datejust', 'Pearlmaster'],
    case_size: ['28mm', '39mm', '40mm', '41mm'],
  }
  const asked = (stockNo: number, reference: string, fields: GapField[] = ['modelName', 'caseSizeMm']) => ({
    row: { id: `w${stockNo}`, stockNo, brandName: 'Rolex', model: reference, modelName: null, caseSizeMm: null },
    fields,
  })
  const said = (over: Partial<Proposal> & Pick<Proposal, 'stock_no'>): Proposal => ({
    family: '', case_size_mm: 0, confidence: 'high', reasoning: 'because', ...over,
  })

  it('takes a confident answer whose family the shop has', () => {
    const { suggestions } = acceptProposals(
      [said({ stock_no: 9002, family: 'Submariner Date "Hulk"', case_size_mm: 40 })],
      [asked(9002, '116610LV')],
      choices,
    )
    expect(suggestions.map((s) => [s.field, s.value])).toEqual([
      ['modelName', 'Submariner Date "Hulk" 40'],
      ['caseSizeMm', '40'],
    ])
    expect(suggestions.every((s) => s.source === 'claude')).toBe(true)
  })

  it('drops an invented family even when it is stated confidently', () => {
    // The guarantee. The prompt asks it to choose from the list; this is
    // what makes the asking binding.
    const { suggestions, dropped } = acceptProposals(
      [said({ stock_no: 9003, family: 'Submariner Professional', case_size_mm: 40 })],
      [asked(9003, '999999ZZ')],
      choices,
    )
    expect(suggestions.map((s) => s.field)).toEqual(['caseSizeMm'])
    expect(dropped).toBe(1)
  })

  it('drops everything it is not sure about', () => {
    const { suggestions } = acceptProposals(
      [said({ stock_no: 9002, family: 'Daytona', case_size_mm: 40, confidence: 'low' })],
      [asked(9002, '116610LV')],
      choices,
    )
    expect(suggestions).toEqual([])
  })

  it('drops an answer about a watch nobody asked about', () => {
    // The clearest signal an answer is confabulated rather than recalled.
    const { suggestions, dropped } = acceptProposals(
      [said({ stock_no: 4242, family: 'Daytona', case_size_mm: 40 })],
      [asked(9002, '116610LV')],
      choices,
    )
    expect(suggestions).toEqual([])
    expect(dropped).toBe(1)
  })

  it('drops a size the shop cannot store, and keeps the name', () => {
    // The Richard Mille case: 38.7 x 47.5mm, and none of the shop's eleven
    // sizes fit. The family is still useful; the size would change nothing.
    const { suggestions } = acceptProposals(
      [said({ stock_no: 1529, family: 'Pearlmaster', case_size_mm: 38 })],
      [asked(1529, '67-01')],
      choices,
    )
    expect(suggestions.map((s) => s.field)).toEqual(['modelName'])
  })

  it('does not answer a field that was not missing', () => {
    const { suggestions } = acceptProposals(
      [said({ stock_no: 1573, family: 'Pearlmaster', case_size_mm: 39 })],
      [asked(1573, '86348SAJOR', ['caseSizeMm'])],
      choices,
    )
    expect(suggestions.map((s) => [s.field, s.value])).toEqual([['caseSizeMm', '39']])
  })

  it('offers nothing at all when it knows nothing', () => {
    const { suggestions } = acceptProposals(
      [said({ stock_no: 9003, family: '', case_size_mm: 0, confidence: 'low' })],
      [asked(9003, '999999ZZ')],
      choices,
    )
    expect(suggestions).toEqual([])
  })
})
