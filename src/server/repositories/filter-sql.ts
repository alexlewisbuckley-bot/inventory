import {
  and, eq, gt, ilike, inArray, isNotNull, isNull, lt, not, notInArray, sql, type SQL,
} from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { FieldSpec, FilterClause, FilterOperator } from '@/lib/filters'

/**
 * Filter clauses, turned into SQL.
 *
 * The half of the grammar that touches the database, kept apart from the half
 * that touches the URL. `src/lib/filters.ts` decides whether a clause is
 * *coherent*; this decides what it *means*. Splitting them is what allows the
 * grammar to be unit-tested without a database and the SQL to be reasoned
 * about without a browser.
 *
 * Nothing here trusts its input. A clause has already been validated by the
 * time it arrives, but the column map is the second gate: a field with no
 * column mapping produces no SQL at all rather than an interpolated string,
 * which is the difference between a filter that silently does nothing and an
 * injection.
 */

export type ColumnMap = Record<string, ColumnBinding>

export interface ColumnBinding {
  column: AnyPgColumn | SQL
  /**
   * How the value in the URL relates to the value in the column.
   *
   * Money is the reason this exists: filters are written in pounds because
   * that is what a person types, and stored in pence because that is what
   * arithmetic requires. `£10,000` in a URL has to become `1000000` before it
   * reaches a comparison, and forgetting that produces a filter that appears
   * to work and is wrong by a factor of a hundred.
   */
  kind: 'text' | 'enum' | 'number' | 'money' | 'date'
}

/**
 * One clause as a SQL condition, or undefined when it cannot be expressed.
 *
 * Undefined rather than a thrown error: a clause referencing a column this
 * list does not have is a stale link, and a stale link should narrow the
 * results by less than expected, not fail to load.
 */
export function clauseToSql(
  clause: FilterClause,
  columns: ColumnMap,
  fields: readonly FieldSpec[],
): SQL | undefined {
  const binding = columns[clause.field]
  if (!binding) return undefined
  if (!fields.some((field) => field.key === clause.field)) return undefined

  const column = binding.column as AnyPgColumn
  const values = clause.values

  switch (clause.operator) {
    case 'is':
      if (values.length === 0) return undefined
      return values.length === 1
        ? eq(column, coerce(values[0]!, binding.kind))
        : inArray(column, values.map((value) => coerce(value, binding.kind)))

    case 'isNot':
      if (values.length === 0) return undefined
      // `NOT IN` is false for NULL, so a watch with no location would vanish
      // from "Location is not the vault" — which is not what anybody means by
      // "is not". The NULL case is spelled out.
      return or(
        values.length === 1
          ? not(eq(column, coerce(values[0]!, binding.kind)))
          : notInArray(column, values.map((value) => coerce(value, binding.kind))),
        isNull(column),
      )

    case 'contains':
      return values.length === 1 ? ilike(column, `%${escapeLike(values[0]!)}%`) : undefined

    case 'notContains':
      return values.length === 1
        ? or(not(ilike(column, `%${escapeLike(values[0]!)}%`)), isNull(column))
        : undefined

    case 'gt':
      return values[0] === undefined ? undefined : gt(column, coerce(values[0], binding.kind))

    case 'lt':
      return values[0] === undefined ? undefined : lt(column, coerce(values[0], binding.kind))

    case 'after':
      return values[0] === undefined ? undefined : gt(column, new Date(values[0]))

    case 'before':
      return values[0] === undefined ? undefined : lt(column, new Date(values[0]))

    case 'isEmpty':
      return isNull(column)

    case 'isNotEmpty':
      return isNotNull(column)

    default:
      return undefined
  }
}

/** Every clause, ANDed. Clauses that cannot be expressed are simply absent. */
export function filtersToSql(
  clauses: FilterClause[],
  columns: ColumnMap,
  fields: readonly FieldSpec[],
): SQL | undefined {
  const conditions = clauses
    .map((clause) => clauseToSql(clause, columns, fields))
    .filter(Boolean) as SQL[]
  return conditions.length > 0 ? and(...conditions) : undefined
}

/**
 * `%` and `_` inside a search term are literal characters, not wildcards.
 *
 * Somebody searching for "50%" means fifty per cent, not "anything". Without
 * this, that query returns the whole table and reads as a broken filter.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function coerce(value: string, kind: ColumnBinding['kind']): string | number | Date {
  if (kind === 'money') {
    // Pounds in, pence out. Rounded rather than truncated so £10.005 does not
    // silently become £10.00 on one screen and £10.01 on another.
    const pounds = Number(value)
    return Number.isFinite(pounds) ? Math.round(pounds * 100) : 0
  }
  if (kind === 'number') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (kind === 'date') return new Date(value)
  return value
}

// Drizzle's `or` returns `SQL | undefined`; narrowing here keeps the call sites
// above readable rather than sprinkling non-null assertions through them.
function or(...conditions: Array<SQL | undefined>): SQL | undefined {
  const present = conditions.filter(Boolean) as SQL[]
  if (present.length === 0) return undefined
  if (present.length === 1) return present[0]
  return sql`(${sql.join(present, sql` OR `)})`
}
