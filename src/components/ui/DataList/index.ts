/**
 * The list system.
 *
 * One filter grammar, one selection model, one bulk bar, for every list in the
 * product. Built against inventory first because it had the most mature
 * pattern to generalise from, and extracted only once sales and contacts
 * needed it — a shared abstraction written before its second consumer is a
 * guess about what the second consumer will want.
 */
export { FilterBar } from './FilterBar'
export type { ReferenceOptions } from './FilterBar'
export { FilterChip } from './FilterChip'
export { SelectAllBanner } from './SelectAllBanner'
