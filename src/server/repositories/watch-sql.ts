import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { watches } from '../db/schema'

/**
 * How stock is grouped when somebody filters it.
 *
 * Three fragments, shared rather than copied. They decide what a model, a
 * dial and a metal *are* for the purpose of a menu, and the inventory list
 * and the trade catalogue have to agree about that or the same watch files
 * under "Pink" in one place and "Pink, diamond-set" in the other. They were
 * private to the inventory repository until the catalogue needed the same
 * answers; a second copy would have drifted the first time one was tuned.
 */
/**
 * The family a watch belongs to, read off its nickname, as SQL.
 *
 * Two cuts, and the order matters.
 *
 * First everything from a quote or a dash onward, because a nickname is a
 * family plus the name the trade gave one version of it: Submariner
 * "Hulk", Submariner "Starbucks", GMT-Master II "Root Beer". Left whole,
 * every nicknamed watch becomes its own family of one and the Model row
 * turns into a list of individual watches — measured on the seed, eight
 * families for fifteen named watches, which is a menu that answers no
 * question. Cut, they collect under Submariner, where somebody asking for
 * a Submariner will find them.
 *
 * Then a trailing case size, 20 to 60: a Datejust 41 and a Datejust 31 are
 * one family in two sizes, and the size has a row of its own. Bounded,
 * because a bare trailing-number rule reads "RM 011" as an RM in 11mm and
 * files a Richard Mille under "RM".
 *
 * This goes one step further than `familyOf` in shopify-map, which only
 * takes the size off. That is not drift: familyOf feeds the shop's model
 * list, and the storefront makes the same quote cut itself in famOf when it
 * builds its menu. The customer sees the same grouping either way; this is
 * the first place the trade side has had it.
 */
const FAMILY_SQL = sql`nullif(btrim(regexp_replace(regexp_replace(${watches.nickname}, '\\s*[“”"–—].*$', ''), '\\s+(2[0-9]|[3-5][0-9]|60)(\\s*mm)?$', '', 'i')), '')`

/**
 * The thing itself, without the sentence about it.
 *
 * A dial is recorded as "Pink, diamond-set" and a bracelet as "Oyster
 * (72419)". Those are true, and useless as filters: picking Pink would find
 * the plain ones and miss the diamond-set one, and a menu of forty dials
 * each holding a single watch is a menu nobody opens twice.
 *
 * So the head of the value is what gets counted and matched — everything up
 * to the first comma, bracket or " with ". Never trimmed away to nothing: a
 * value that is all description is better offered whole than offered blank.
 *
 * Deliberately the same cut as `withoutDescription` in shopify-metafields,
 * which does this for the storefront's own filters. Stated twice because one
 * is Postgres and the other is TypeScript and neither can call the other;
 * tests/stock-facets.test.ts holds them to the same answers.
 */
const headOf = (column: AnyPgColumn) => sql<string>`nullif(btrim(
  case
    when length(btrim(regexp_replace(${column}, '(,|\\(| with ).*$', '', 'i'))) >= 2
      then regexp_replace(${column}, '(,|\\(| with ).*$', '', 'i')
    else ${column}
  end
), '')`

const DIAL_SQL = headOf(watches.dial)
const MATERIAL_SQL = headOf(watches.caseMaterial)

export { FAMILY_SQL, DIAL_SQL, MATERIAL_SQL, headOf }
