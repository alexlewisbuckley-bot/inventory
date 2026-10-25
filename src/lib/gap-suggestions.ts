import { cardGaps, familyOf, sizeOf, type SyncWatch } from './shopify-map'

/**
 * Filling the blanks a product card falls over.
 *
 * `cardGaps` says which watches cannot fill a card. This says what to put in
 * them — as a proposal on a worklist, never as a write. The distinction is the
 * whole design, and it is not timidity: this system already refuses three
 * times over to guess at this exact data.
 *
 *   familyOf:          "Returns null rather than guessing from the reference.
 *                       A reference prefix implies a family only if you
 *                       already know Rolex's numbering, and a menu
 *                       confidently filed under the wrong name is worse than
 *                       one with a gap in it."
 *   resolveMetafields: "An unmatched field is left out rather than guessed at.
 *                       A watch listed with the wrong dial colour is worse
 *                       than one listed with none."
 *   cardGaps:          "No mapping can invent a model name."
 *
 * Those stay true. What changes is that a gap now arrives with a candidate
 * answer and the evidence for it, so filling it is a glance and a click
 * instead of a search. Nothing reaches a watch until somebody accepts it.
 */

/** The two things a card needs that a reference can actually settle. */
export type GapField = 'modelName' | 'caseSizeMm'

export interface Suggestion {
  watchId: string
  stockNo: number
  /** The reference, which is what the suggestion is reasoned from. */
  reference: string
  field: GapField
  /** What to put in the field. A size is carried as its number of millimetres. */
  value: string
  /** Where the answer came from, which decides how hard to look at it. */
  source: 'book' | 'claude'
  /** Why, in words a person can check: stock numbers, or Claude's reasoning. */
  evidence: string
}

/** What this needs off a watch. A subset of the row the content page already has. */
export interface GapRow extends Pick<SyncWatch, 'model' | 'modelName' | 'caseSizeMm'> {
  id: string
  stockNo: number
  brandName: string
}

/**
 * Why the dial is not on this list.
 *
 * It is the emptiest field in the book and the obvious thing to want filled,
 * and it is the one a reference cannot settle. 126334 is a Datejust 41 and it
 * is 41mm — both facts live in the number. It is also blue, silver, green,
 * slate, wimbledon and five others depending on the watch in front of you.
 *
 * So a dial proposed from a reference is a coin toss wearing the costume of an
 * inference, and it would be wrong often enough to teach whoever is clicking
 * Accept to stop reading first. One careless habit learned on dial colour is
 * worth more damage than every blank dial in the book. The photograph is where
 * that answer lives; this is not that feature.
 */
const SETTLED_BY_REFERENCE: readonly GapField[] = ['modelName', 'caseSizeMm']

/** Case-insensitively, ignoring the punctuation dealers vary. 5740/1G-001 = 5740 1g 001. */
export function sameReference(a: string | null, b: string | null): boolean {
  const key = (value: string | null) => (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  const left = key(a)
  return left.length > 0 && left === key(b)
}

/** Which of the two a watch is actually missing, read off the card's own test. */
export function gapsOf(row: GapRow): GapField[] {
  const gaps = cardGaps(row)
  const fields: GapField[] = []
  if (gaps.includes('model')) fields.push('modelName')
  if (gaps.includes('size')) fields.push('caseSizeMm')
  return fields.filter((field) => SETTLED_BY_REFERENCE.includes(field))
}

/** What a watch already says for a field, or null where it says nothing. */
function valueOf(row: GapRow, field: GapField): string | null {
  if (field === 'caseSizeMm') {
    const size = sizeOf(row)
    return size ? String(size) : null
  }
  const family = familyOf(row)
  return family ? (row.modelName?.trim() ?? null) : null
}

/**
 * The first place to look is the book itself.
 *
 * A dealer restocks: eight of the watches here are reference 126334, and they
 * are all Datejust 41, all 41mm, because that is what the number means. So a
 * ninth arriving blank does not need a model that knows about watches. It
 * needs the eight already on the shelf.
 *
 * This is the better answer wherever it is available — free, instant, and
 * checkable against records the business wrote itself rather than against
 * anybody's recollection. Claude is for the references the book has never
 * held.
 *
 * Unanimity or nothing. Where the watches sharing a reference disagree, the
 * disagreement is the finding: one of them is wrong, and picking the more
 * popular spelling would bury that. Those are left blank and stay on the
 * worklist, which is the honest outcome.
 */
export function suggestFromBook(rows: GapRow[]): Suggestion[] {
  const out: Suggestion[] = []

  for (const row of rows) {
    for (const field of gapsOf(row)) {
      const peers = rows.filter(
        (other) => other.id !== row.id && sameReference(other.model, row.model) && valueOf(other, field),
      )
      if (!peers.length) continue

      const values = new Set(peers.map((peer) => valueOf(peer, field)!))
      if (values.size !== 1) continue

      const value = [...values][0]
      const cited = peers.map((peer) => String(peer.stockNo)).slice(0, 4)
      const more = peers.length - cited.length
      out.push({
        watchId: row.id,
        stockNo: row.stockNo,
        reference: row.model,
        field,
        value,
        source: 'book',
        evidence:
          `${peers.length === 1 ? 'Stock' : 'Stock'} ${cited.join(', ')}` +
          `${more > 0 ? ` and ${more} more` : ''} — same reference, ` +
          `${peers.length === 1 ? 'recorded as' : 'all recorded as'} ${value}` +
          `${field === 'caseSizeMm' ? 'mm' : ''}.`,
      })
    }
  }

  return out
}

/** The watches no peer could answer for, which are the ones worth asking about. */
export function unresolved(rows: GapRow[], found: Suggestion[]): Array<{ row: GapRow; fields: GapField[] }> {
  const answered = new Set(found.map((s) => `${s.watchId}:${s.field}`))
  const out: Array<{ row: GapRow; fields: GapField[] }> = []
  for (const row of rows) {
    const fields = gapsOf(row).filter((field) => !answered.has(`${row.id}:${field}`))
    if (fields.length) out.push({ row, fields })
  }
  return out
}

/**
 * A size is only useful if the shop has somewhere to put it.
 *
 * `case_size` is one of the fields the push will not invent an entry for: an
 * unmatched one is dropped in silence, so a watch recorded as 38.7mm reaches
 * the website with no size at all and the card is no better off than before.
 * The Richard Mille is the standing example — its case is 38.7 by 47.5 and
 * none of the shop's eleven sizes fit it.
 *
 * So a suggestion the shop cannot store is not offered. Better to leave the
 * gap, and say why, than to have somebody accept a value and find the card
 * unchanged.
 */
export function storable(value: string, field: GapField, choices: Record<string, string[]>): boolean {
  if (field !== 'caseSizeMm') return true
  const sizes = choices.case_size
  // No vocabulary read (the shop is unreachable, or not configured) is not
  // evidence of absence — offer the suggestion rather than silently withhold.
  if (!sizes?.length) return true
  return sizes.some((size) => size.toLowerCase().replace(/[^0-9]/g, '') === value.replace(/[^0-9]/g, ''))
}

/**
 * The model name to write, from a family the shop already knows.
 *
 * Claude is asked for a family off the shop's own list rather than for a
 * title, because a list of forty-two is checkable and a free-text title is
 * not. The size is put back on here, to the convention the book already uses
 * — "Datejust 41", which `familyOf` reads back as Datejust and `resolveFamily`
 * maps to the shop's Datejust.
 *
 * A family that already carries a size does not get a second one. The shop
 * holds both "Datejust" and "Datejust 31"; pairing the latter with 31mm would
 * write "Datejust 31 31".
 */
export function nicknameFrom(family: string, sizeMm: number | null): string {
  const name = family.trim()
  if (!sizeMm) return name
  if (new RegExp(`\\s0*${sizeMm}$`).test(name)) return name
  return `${name} ${sizeMm}`
}

/**
 * Whether a family Claude returned is one the shop actually has.
 *
 * The guarantee that it cannot invent a model. The prompt asks it to choose
 * from the list; this is what makes the asking binding, because a prompt is a
 * request and a check is a rule. Anything not on the list is dropped without
 * ceremony — a name the shop has no entry for would be filed nowhere by the
 * push anyway.
 */
export function knownFamily(family: string, choices: Record<string, string[]>): boolean {
  const list = choices.model
  if (!family.trim()) return false
  // With no vocabulary read there is nothing to check against, and a
  // suggestion nobody can verify is exactly what this feature must not make.
  if (!list?.length) return false
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return list.some((known) => key(known) === key(family))
}

/** What Claude is asked to return, one per watch it was given. */
export interface Proposal {
  stock_no: number
  family: string
  case_size_mm: number
  confidence: string
  reasoning: string
}

/**
 * Turning what Claude said into what may be offered.
 *
 * Separate from the call that fetches it, and unit-tested, because this is
 * where the guarantees actually live. The prompt asks for a family off the
 * shop's list; everything that makes that binding happens here, against
 * answers this file can be handed directly in a test.
 *
 * Four reasons a proposal is dropped, and the first is the one that matters
 * most: a stock number nobody asked about. A model returning a watch that was
 * not in the question is the clearest signal available that an answer is
 * invented rather than recalled, and it must not reach the worklist on the
 * strength of being confidently phrased.
 */
export function acceptProposals(
  proposals: Proposal[],
  items: Array<{ row: GapRow; fields: GapField[] }>,
  choices: Record<string, string[]>,
): { suggestions: Suggestion[]; dropped: number } {
  const byStock = new Map(items.map((item) => [item.row.stockNo, item]))
  const suggestions: Suggestion[] = []
  let dropped = 0

  for (const proposal of proposals) {
    const item = byStock.get(proposal.stock_no)
    if (!item) { dropped += 1; continue }
    // "low" is a real answer and the prompt says there is no penalty for it.
    if (proposal.confidence !== 'high') { dropped += 1; continue }

    const size =
      Number.isFinite(proposal.case_size_mm) && proposal.case_size_mm > 0
        ? Math.round(proposal.case_size_mm)
        : null
    const evidence = String(proposal.reasoning ?? '').slice(0, 200)

    if (item.fields.includes('modelName')) {
      if (knownFamily(proposal.family, choices)) {
        suggestions.push({
          watchId: item.row.id,
          stockNo: item.row.stockNo,
          reference: item.row.model,
          field: 'modelName',
          value: nicknameFrom(proposal.family, size),
          source: 'claude',
          evidence,
        })
      } else {
        dropped += 1
      }
    }

    if (item.fields.includes('caseSizeMm') && size) {
      if (storable(String(size), 'caseSizeMm', choices)) {
        suggestions.push({
          watchId: item.row.id,
          stockNo: item.row.stockNo,
          reference: item.row.model,
          field: 'caseSizeMm',
          value: String(size),
          source: 'claude',
          evidence,
        })
      } else {
        dropped += 1
      }
    }
  }

  return { suggestions, dropped }
}
