export { familyOf }
import { BOX_PAPERS_LABELS, CONDITION_LABELS, type BoxPapers, type Condition } from './enums'
import { familyOf, type SyncWatch } from './shopify-map'

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

/** One structured field the shop could hold for this watch. */
export interface DesiredMetaobject {
  /** The metaobject type, which is also the metafield key. */
  type: string
  /** The entry's display name, as the shop spells it. */
  name: string
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
  const wanted: Array<DesiredMetaobject | null> = [
    { type: 'brand', name: watch.brandName },
    watch.dial ? { type: 'dial', name: alias(watch.dial) } : null,
    watch.bracelet ? { type: 'bracelet', name: alias(watch.bracelet) } : null,
    watch.caseMaterial ? { type: 'material', name: alias(watch.caseMaterial) } : null,
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
    const id = index.get(want.type)?.get(normalise(want.name))
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
