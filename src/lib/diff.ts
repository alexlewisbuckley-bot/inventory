/**
 * Pure field-level diffing, used to build audit change sets.
 *
 * Deliberately free of any database import so it stays unit-testable and
 * reusable from both server and client code.
 */
export type ChangeSet = Record<string, { from: unknown; to: unknown }>

/**
 * Compare `before` against a partial `after`, limited to `fields`.
 *
 * Fields absent from `after` are ignored rather than treated as cleared, so a
 * partial update never records a spurious "set to undefined". Returns
 * `undefined` when nothing changed so no-op saves write no audit noise.
 */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[],
): ChangeSet | undefined {
  const changes: ChangeSet = {}
  for (const field of fields) {
    if (!(field in after)) continue
    const from = before[field]
    const to = after[field]
    const same = from instanceof Date && to instanceof Date
      ? from.getTime() === to.getTime()
      : from === to
    if (!same) changes[String(field)] = { from: normalise(from), to: normalise(to) }
  }
  return Object.keys(changes).length > 0 ? changes : undefined
}

const normalise = (value: unknown): unknown => (value instanceof Date ? value.toISOString() : value)
