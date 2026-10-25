export { familyOf }
import { BOX_PAPERS_LABELS, CONDITION_LABELS, type BoxPapers, type Condition } from './enums'
import { familyOf, type SyncWatch } from './shopify-map'
import { materialFromReference } from './rolex-reference'

/**
 * The shop's structured fields, filled from the record where they can be.
 *
 * The storefront does not hold "dial: White" as text. It holds a pointer to an
 * entry in a list of dials, and the theme's filters are built on those entries
 * — so a product created without them is live, correct and invisible to anyone
 * browsing by dial colour.
 *
 * This works out which entries a watch should point at. It never invents one:
 * the lists are the shop's own taxonomy, and a sync that quietly added
 * "white", "White" and "Silver-white" to it would be worse than a sync that
 * left the field blank and said so.
 */

/**
 * Two names for the same thing.
 *
 * Case, punctuation and spacing differ between a system that was typed into by
 * one person and a shop that was typed into by another — "Mother-of-pearl" and
 * "Mother of Pearl" are not a disagreement about the dial.
 */
export function normalise(value: string): string {
  // An ampersand is read as the word, not thrown away with the punctuation.
  // The shop writes "Titanium and Platinum" where a record says "Titanium &
  // Platinum", and discarding the symbol left "titaniumplatinum" against
  // "titaniumandplatinum" — one metal reported as a gap in the shop's list
  // when the shop had it all along. Read before the rest is discarded, or
  // there is nothing left to read it from.
  return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')
}

/**
 * Where the two vocabularies genuinely differ, rather than merely in spelling.
 *
 * Deliberately short. Every line is a judgement that two different words mean
 * one thing, and the place for a judgement is a table somebody can read, not a
 * similarity score inside a loop.
 */
const ALIASES: Record<string, string> = {
  // Rolex's own name for the Daytona family, where the shop files it short.
  'cosmograph daytona': 'Daytona',
  // The inventory system's way of saying a watch has its box and its papers.
  'full set': 'Box & papers',
  'watch only': 'Neither',
  // A silver dial and a silvered dial are the same dial, and the shop now
  // calls it Silver — one name for one colour, rather than two rows in a
  // filter that mean the same thing. The alias points the other way than it
  // used to: records written before the rename still say "Silvered", and
  // there is no reason to make somebody retype forty of them.
  silvered: 'Silver',
  /*
    DIAL SHADES, FILED UNDER THEIR COLOUR.
    ---------------------------------------------------------------
    The shop's dial list is a dozen colours and it is a FILTER, not a
    description: somebody browsing clicks Blue because they want a blue
    watch, and a Deepsea whose dial this system calls "D-Blue" is a blue
    watch. Unaliased it matches no entry at all, so it is dropped — and a
    watch with no dial is in no filter, which is strictly worse than being
    in a slightly coarse one. Four Blues on the website against a case full
    of them was this, sixteen watches over.

    The shade is not lost. It stays on the record, in the listing copy and
    in the trade catalogue; only the thing the storefront files it under is
    coarsened, which is what a filter is for.

    "Olive green" used to map to Olive, on the reasoning that olive is its
    own colour and "green" after it is the shade. True about colour and
    wrong about this list: the shop has no Olive entry and never did, so
    the answer was a dial nobody could browse to. Creating one would split
    the greens in two, which is the splitting CREATABLE_TYPES exists to
    prevent. Under Green it is found.
  */
  // Greens.
  'olive green': 'Green',
  olive: 'Green',
  'mint green': 'Green',
  'dark green': 'Green',
  // Blues. "D-Blue" is Rolex's own name for the Deepsea's graded dial.
  'd-blue': 'Blue',
  dblue: 'Blue',
  'dark blue': 'Blue',
  'light blue': 'Blue',
  // Greys.
  'dark grey': 'Grey',
  'dark gray': 'Grey',
  'slate grey': 'Grey',
  'slate gray': 'Grey',
  gray: 'Grey',
  // Whites and the mother-of-pearls, which the shop keeps as one entry.
  ivory: 'White',
  'dark mother-of-pearl': 'Mother of Pearl',
  'white mother-of-pearl': 'Mother of Pearl',
  'black mother-of-pearl': 'Mother of Pearl',
  'pink mother-of-pearl': 'Mother of Pearl',
  // Pinks.
  'candy pink': 'Pink',
  'rose pink': 'Pink',
  // A Jubilee motif dial is a silvered dial with a pattern pressed into it.
  'silver jubilee': 'Silver',
  'silver jubilee motif': 'Silver',
  'jubilee motif': 'Silver',
  // Spelled out once and then abbreviated, in the same breath. The shop keeps
  // one entry called "Mother of Pearl"; a second one carrying the initials
  // would split the dial between two filters.
  'mother of pearl (mop)': 'Mother of Pearl',
  // Carats, spelled the other way.
  '18ct white gold': '18k White Gold',
  '18ct yellow gold': '18k Yellow Gold',
  '18ct rose gold': '18k Rose Gold',
  '18ct everose gold': '18k Everose Gold',
}

function alias(value: string): string {
  return ALIASES[value.trim().toLowerCase()] ?? value
}

/**
 * The thing itself, without the sentence about it.
 *
 * A dial is recorded as "Pink, diamond-set" or "Black with grey subdials", and
 * a bracelet as "Oyster (72419)". The shop's lists hold the thing — Pink,
 * Black, Oyster — and the rest is a description of this particular watch,
 * which belongs in the copy and not in a filter.
 *
 * Trimming is what makes creating safe. An untrimmed value added to the shop's
 * own list gives it a dial called "Black with grey subdials" holding exactly
 * one watch, and a Black filter that no longer finds that watch — the same
 * splitting that turned the model menu into a hundred families of one. Cut at
 * the comma, the bracket or the "with", and the worst this can add is a colour.
 */
export function withoutDescription(value: string): string {
  const cut = value.split(/,|\(| with /i)[0] ?? value
  const head = cut.trim()
  // Never trim something away to nothing: a value that is all description is
  // better reported whole than reported as an empty string.
  return head.length >= 2 ? head : value.trim()
}

/**
 * The metals the shop filters on, and nothing else.
 *
 * The filter had fourteen entries because it was showing the trade's own
 * vocabulary: Oystersteel and Stainless Steel as two different things, three
 * kinds of Rolesor, four golds separated by carat, and a Rolesium holding one
 * watch. That is how a dealer files a case and not how anybody shops for one
 * — somebody wants a gold watch, or a two-tone, and the carat is a detail
 * they read on the product page once they are already interested.
 *
 * Nine, chosen by Alex. Steel & White Gold is the one he did not list and
 * agreed to: White Rolesor is twenty-nine watches, exactly the same kind of
 * thing as the other two two-tones, and folding it into Steel would have made
 * Steel the biggest bucket on the site by losing the distinction people pay
 * for.
 */
export const MATERIAL_GROUPS = [
  'Yellow Gold',
  'Rose Gold',
  'White Gold',
  'Platinum',
  'Titanium',
  'Steel',
  'Steel & Yellow Gold',
  'Steel & Rose Gold',
  'Steel & White Gold',
] as const

/**
 * One of those nine, from whatever the record or the reference calls it.
 *
 * Read in this order on purpose. A two-tone names two metals, so testing for
 * gold first would file every Rolesor under gold; and "Titanium and Platinum"
 * names two, so the titanium has to win before the platinum is seen.
 *
 * Null rather than a guess for anything unrecognised. An unmatched material
 * is already reported as a gap somebody can fill, and a wrong one is a watch
 * filed under a metal it is not made of.
 */
export function materialGroup(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (!v) return null

  // Already grouped — idempotent, so running this twice cannot drift.
  const exact = MATERIAL_GROUPS.find((group) => group.toLowerCase() === v)
  if (exact) return exact

  const rose = /everose|\brose\b|pink/.test(v)
  const white = /\bwhite\b|\bgrey\b|\bgray\b/.test(v)
  const yellow = /\byellow\b/.test(v)
  const steel = /steel|acier|rolesor/.test(v)
  const gold = /gold|\bor\b/.test(v)

  // Two metals in one case. Rolesor is Rolex's word for exactly this.
  if (/rolesor/.test(v) || (steel && gold)) {
    if (rose) return 'Steel & Rose Gold'
    if (white) return 'Steel & White Gold'
    if (yellow) return 'Steel & Yellow Gold'
    // A two-tone whose second metal we cannot read is not worth guessing at.
    return null
  }

  // Steel case, platinum bezel. Filed under the metal that distinguishes it,
  // at Alex's word — somebody filtering Platinum is looking for this watch.
  if (/rolesium/.test(v)) return 'Platinum'

  // Before platinum, so "Titanium and Platinum" lands on the case metal.
  if (/titanium|titane/.test(v)) return 'Titanium'
  if (/platinum|platine/.test(v)) return 'Platinum'

  if (gold || rose || white || yellow) {
    if (rose) return 'Rose Gold'
    if (white) return 'White Gold'
    if (yellow) return 'Yellow Gold'
  }

  if (steel) return 'Steel'
  return null
}

/**
 * Every metaobject type this system can fill in.
 *
 * Declared once, beside the function that asks for them, because the loader
 * and the asker have to agree and nothing made them: `model` was added to what
 * the sync asks for and not to what it loads, so it looked up a family in an
 * index that had never been told families exist, found nothing, and reported
 * every watch as unmatched. The brand menu the change existed to fix stayed
 * exactly as it was.
 */
export const METAOBJECT_TYPES = [
  'brand', 'model', 'dial', 'bracelet', 'material', 'case_size', 'year',
  'condition', 'box_papers',
] as const

/**
 * The types a missing entry can simply be added to.
 *
 * A year is a year and 36mm is 36mm: if the shop has no entry for 2019, that
 * is a gap, not a disagreement, and filling it cannot produce two entries
 * meaning the same thing.
 *
 * A model family is on it, but only through `creatableName`, which refuses
 * the thing that made it dangerous. The name this system can offer is the
 * whole variant — "Submariner Date Green Hulk" — and creating that would give
 * the shop a family of one watch, six times over, where it wanted Submariner.
 * So a family is offered only when it is short enough and plain enough to be
 * a family: three words at most, no reference number in it. "Air-King" is
 * created; "Submariner Date Green Hulk 41" is still reported for somebody to
 * name properly.
 *
 * Dials and bracelets join them, but only because they are trimmed to the
 * thing itself first — see `withoutDescription`. "Pink" is a colour and can
 * be added; "Pink, diamond-set" is a sentence and would split the filter.
 *
 * Materials are on the list at Alex's word: "the push should be creating
 * these new fields in Shopify". The reservation above is real and worth
 * keeping in mind — the shop says "Two-tone Everose Rolesor" where this
 * system says "Oystersteel and Everose gold", and adding the second gives one
 * metal two filters — but a Titanium the shop has never heard of is a gap,
 * not a disagreement, and leaving the watch out of every material filter is
 * the worse of the two failures. Anything created is named in the run's
 * report, so a duplicate can be merged in Shopify the same day it appears.
 *
 * The brand list, the condition grades and box-and-papers stay off it. Those
 * are short, closed and already complete: a new entry in any of them means
 * this system has spelled something differently, never that the shop is
 * missing a value.
 */
export const CREATABLE_TYPES = ['year', 'case_size', 'material', 'model'] as const

/** The field each type keeps its name in. */
export const NAME_FIELD: Record<string, string> = {
  model: 'model',
  brand: 'brand_name',
}

export function nameFieldFor(type: string): string {
  return NAME_FIELD[type] ?? 'label'
}

export function isCreatable(want: DesiredMetaobject): boolean {
  if (want.canCreate !== true && !(CREATABLE_TYPES as readonly string[]).includes(want.type)) {
    return false
  }
  return creatableName(want) !== null
}

/**
 * The name to add to the shop's list, or null if it should be reported instead.
 *
 * A filter entry is a label people browse by, so it has to be the thing and
 * not a description of this particular watch. Everything creatable is already
 * trimmed at the comma and the bracket (see `withoutDescription`); this is the
 * second gate, for the values that survive trimming and still are not names.
 *
 * Four words or more is a sentence. A reference number is an identifier, and
 * one watch has it. Either way the shop gets told about it rather than given
 * a filter nobody will ever click twice.
 */
export function creatableName(want: DesiredMetaobject): string | null {
  const name = want.name.trim()
  if (name.length < 2 || name.length > 40) return null
  // A year or a case size is a number and is meant to be.
  if (want.type === 'year' || want.type === 'case_size') return name
  // Anything with a run of digits long enough to be a reference is one.
  if (/\d{4,}/.test(name)) return null
  // The nine metals are a closed list this system chose, so they are names by
  // definition — and three of them are four words long, which the rule below
  // would otherwise refuse.
  if ((MATERIAL_GROUPS as readonly string[]).includes(name)) return name
  if (name.split(/\s+/).length > 3) return null
  return name
}

/** One structured field the shop could hold for this watch. */
export interface DesiredMetaobject {
  /** The metaobject type, which is also the metafield key. */
  type: string
  /** The entry's display name, as the shop spells it. */
  name: string
  /**
   * Safe to add to the shop's list if it is not there.
   *
   * True only for a name that came from a closed, canonical table rather than
   * from somebody typing. "Two-tone Everose Rolesor" read off a reference is
   * one of ten possible answers and cannot duplicate an existing entry by
   * saying the same thing differently; "Oystersteel and Everose gold" typed
   * into a record is exactly that risk.
   */
  canCreate?: boolean
}

/**
 * What the shop should say about this watch.
 *
 * Only fields the record actually holds. The family is derived rather than
 * taken from the `model` column, which holds the reference number: the shop's
 * model entries are names — "Datejust II" — and pairing a 116334 with whatever
 * name happened to normalise the same way would be worse than leaving it.
 */
export function desiredMetaobjects(watch: SyncWatch): DesiredMetaobject[] {
  const derivedMaterial = materialFromReference(watch.brandName, watch.model)

  const wanted: Array<DesiredMetaobject | null> = [
    { type: 'brand', name: watch.brandName },
    // Both are trimmed to the thing itself before being looked up, so
    // "Pink, diamond-set" finds the shop's Pink rather than reporting a gap,
    // and — because what is left can only be a name — may be created.
    watch.dial
      ? { type: 'dial', name: alias(withoutDescription(watch.dial)), canCreate: true }
      : null,
    watch.bracelet
      ? { type: 'bracelet', name: alias(withoutDescription(watch.bracelet)), canCreate: true }
      : null,
    // The reference first, where the house encodes it. Rolex, Patek and
    // Audemars all put the case metal in the reference, and that is the one
    // description both systems can agree on without either giving way: the
    // record says "Oystersteel and Everose gold", the shop says "Two-tone
    // Everose Rolesor", and 126711 says which metal without an opinion.
    // Grouped to the nine the shop filters on, from whichever source we have.
    // The reference is tried first because it cannot be typed wrongly, but
    // both ends arrive at the same nine words, so a watch described in the
    // record and one read off its reference file together.
    (() => {
      const metal = materialGroup(derivedMaterial) ?? materialGroup(watch.caseMaterial)
      return metal ? { type: 'material', name: metal, canCreate: true } : null
    })(),
    watch.caseSizeMm ? { type: 'case_size', name: `${watch.caseSizeMm}mm` } : null,
    watch.year ? { type: 'year', name: String(watch.year) } : null,
    watch.condition && watch.condition !== 'UNKNOWN'
      ? { type: 'condition', name: alias(CONDITION_LABELS[watch.condition as Condition]) }
      : null,
    watch.boxPapers && watch.boxPapers !== 'UNKNOWN'
      ? { type: 'box_papers', name: alias(BOX_PAPERS_LABELS[watch.boxPapers as BoxPapers]) }
      : null,
    // The family, which is what the shop's brand menu groups by. Without it
    // the shop falls back to the product's whole title, and a menu of a
    // hundred families is a menu of none.
    (() => {
      const family = familyOf(watch)
      return family ? { type: 'model', name: alias(family) } : null
    })(),
  ]
  return wanted.filter((item): item is DesiredMetaobject => item !== null)
}

/** The shop's taxonomy: type → normalised name → the entry's id. */
export type MetaobjectIndex = Map<string, Map<string, string>>

export function indexMetaobjects(
  entries: Array<{ type: string; displayName: string; id: string }>,
): MetaobjectIndex {
  const index: MetaobjectIndex = new Map()
  for (const entry of entries) {
    const byName = index.get(entry.type) ?? new Map<string, string>()
    // First wins. The shop has two entries called "41mm"; pointing every
    // 41mm watch at the same one of them is the consistent answer.
    if (!byName.has(normalise(entry.displayName))) {
      byName.set(normalise(entry.displayName), entry.id)
    }
    index.set(entry.type, byName)
  }
  return index
}

/**
 * The shop's family for a watch, found by its own vocabulary.
 *
 * Not computed and then matched, which is how this went wrong: a model name is
 * the whole variant — "Submariner Date Green Hulk 41" — and no amount of
 * trimming the end of it reliably yields "Submariner". Deriving a name and
 * hoping the shop uses the same one produced a Model filter with six kinds of
 * Submariner in it, each holding one watch.
 *
 * So the shop's list is the authority. The family is the longest entry in it
 * that the model name contains: "Submariner Date Green Hulk" gives Submariner,
 * "Datejust II Fluted" gives Datejust II rather than Datejust, because the
 * longer name is the more specific true one.
 *
 * Entries shorter than three characters are ignored. The list currently holds
 * one called "A", and a single letter is contained in almost every name there
 * is — it would quietly become the family of half the book.
 */
export function resolveFamily(
  watch: SyncWatch,
  index: MetaobjectIndex,
): { id: string | null; name: string | null } {
  const modelName = watch.modelName?.trim()
  if (!modelName) return { id: null, name: null }

  const haystack = normalise(modelName)
  const families = index.get('model')
  if (!families) return { id: null, name: familyOf(watch) }

  let best: { id: string; length: number } | null = null
  for (const [name, id] of families) {
    if (name.length < 3 || !haystack.includes(name)) continue
    if (!best || name.length > best.length) best = { id, length: name.length }
  }

  return best ? { id: best.id, name: modelName } : { id: null, name: familyOf(watch) }
}

export interface ResolvedMetafields {
  metafields: Array<{ namespace: string; key: string; type: string; value: string }>
  /** What the shop has no entry for, so somebody can be told rather than left to notice. */
  unmatched: DesiredMetaobject[]
}

/**
 * Turn what we want to say into what the shop can store.
 *
 * An unmatched field is left out rather than guessed at. A watch listed with
 * the wrong dial colour is worse than one listed with none: the first is a
 * statement, the second is an omission somebody can fill in.
 */
export function resolveMetafields(
  watch: SyncWatch,
  index: MetaobjectIndex,
): ResolvedMetafields {
  const metafields: ResolvedMetafields['metafields'] = []
  const unmatched: DesiredMetaobject[] = []

  for (const want of desiredMetaobjects(watch)) {
    // The family is the one field found by what the shop already calls things
    // rather than by matching a name this system made up.
    const id = want.type === 'model'
      ? resolveFamily(watch, index).id
      : index.get(want.type)?.get(normalise(want.name))
    if (!id) { unmatched.push(want); continue }
    metafields.push({
      namespace: 'custom',
      key: want.type,
      type: 'metaobject_reference',
      value: id,
    })
  }

  return { metafields, unmatched }
}
