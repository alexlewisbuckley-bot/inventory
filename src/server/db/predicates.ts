import { and, isNull, type SQL } from 'drizzle-orm'
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
