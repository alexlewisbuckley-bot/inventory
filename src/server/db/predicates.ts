import { and, isNull, sql, type SQL } from 'drizzle-orm'
import { sales } from './schema'

/**
 * A sale that still counts.
 *
 * There are now two ways a sale can stop counting — soft deletion and voiding —
 * and a query that remembers only the first silently reports revenue from an
 * invoice that was cancelled. Keeping the predicate in one place means adding a
 * third condition later is a single edit rather than a hunt, and the guard in
 * tests/sale-filters.test.ts fails the build if a query is written by hand
 * instead of using this.
 */
export function liveSale(): SQL {
  return and(isNull(sales.deletedAt), isNull(sales.voidedAt))!
}

/**
 * Stock you can put your hands on.
 *
 * Alex: "Please ensure the hidden / inactive watches do not show up on search
 * for staff, they are seeing various watches that are in inactive locations."
 *
 * A location carries a switch the Locations screen calls Active, which is the
 * `is_on_hand` column: off for a courier's bag and for another country. Stock
 * standing somewhere that is off is still ours and still counted in capital
 * and in the reports, and it is deliberately absent from the stock list —
 * trackable only from the location itself.
 *
 * This existed as the same sub-select written out by hand in a dozen queries,
 * which is why two of them did not have it: the palette's search returned
 * watches the stock list hides, and Today counted 294 held beside a sidebar
 * reading 198. One predicate, and a guard in tests/stock-visibility.test.ts
 * that fails the build if the thirteenth query writes it out again.
 *
 * A sub-select on the id rather than a condition on a joined `locations` row,
 * because several of the callers join brands alone and a WHERE naming a table
 * that is not in the FROM is a 500.
 */
export function onHandStock(column = 'watches.location_id'): SQL {
  return sql.raw(`${column} IN (SELECT l.id FROM locations l WHERE l.is_on_hand)`)
}
