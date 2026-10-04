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
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
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
  // A silver dial and a silvered dial are the same dial.
  silver: 'Silvered',
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
 * A model family is not on the list either, and for a sharper reason: the name
 * this system can offer is the whole variant — "Submariner Date Green Hulk" —
 * and creating that would give the shop a family of one watch, six times over,
 * where it wanted Submariner. A family it does not already have is reported so
 * somebody can name it properly.
 *
 * Everything else is a curated vocabulary and is deliberately left alone. The
 * shop calls a material "Two-tone Everose Rolesor"; this system calls the same
 * metal "Oystersteel and Everose gold". Creating the second would not fill a
 * gap — it would split one material into two filters, each with half the
 * watches, and nobody would notice until a customer did. Those are reported
 * instead, so somebody who knows which is which decides.
 */
export const CREATABLE_TYPES = ['year', 'case_size'] as const

/** The field each type keeps its name in. */
export const NAME_FIELD: Record<string, string> = {
  model: 'model',
  brand: 'brand_name',
}

export function nameFieldFor(type: string): string {
  return NAME_FIELD[type] ?? 'label'
}

export function isCreatable(want: DesiredMetaobject): boolean {
  return want.canCreate === true || (CREATABLE_TYPES as readonly string[]).includes(want.type)
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
    watch.dial ? { type: 'dial', name: alias(watch.dial) } : null,
    watch.bracelet ? { type: 'bracelet', name: alias(watch.bracelet) } : null,
    // The reference first, where the house encodes it. Rolex, Patek and
    // Audemars all put the case metal in the reference, and that is the one
    // description both systems can agree on without either giving way: the
    // record says "Oystersteel and Everose gold", the shop says "Two-tone
    // Everose Rolesor", and 126711 says which metal without an opinion.
    derivedMaterial
      ? { type: 'material', name: derivedMaterial, canCreate: true }
      : watch.caseMaterial
        ? { type: 'material', name: alias(watch.caseMaterial) }
        : null,
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
 * Not computed and then matched, which is how this went wrong: a nickname is
 * the whole variant — "Submariner Date Green Hulk 41" — and no amount of
 * trimming the end of it reliably yields "Submariner". Deriving a name and
 * hoping the shop uses the same one produced a Model filter with six kinds of
 * Submariner in it, each holding one watch.
 *
 * So the shop's list is the authority. The family is the longest entry in it
 * that the nickname contains: "Submariner Date Green Hulk" gives Submariner,
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
  const nickname = watch.nickname?.trim()
  if (!nickname) return { id: null, name: null }

  const haystack = normalise(nickname)
  const families = index.get('model')
  if (!families) return { id: null, name: familyOf(watch) }

  let best: { id: string; length: number } | null = null
  for (const [name, id] of families) {
    if (name.length < 3 || !haystack.includes(name)) continue
    if (!best || name.length > best.length) best = { id, length: name.length }
  }

  return best ? { id: best.id, name: nickname } : { id: null, name: familyOf(watch) }
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
