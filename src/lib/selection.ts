/**
 * Selection across a paginated list, as a value.
 *
 * The interesting part is not the set of ids — it is the distinction between
 * "these fourteen rows" and "everything matching this filter". V1 only had the
 * first, so `⌘A` on a filtered list of 300 selected the 25 on screen and the
 * bulk bar said "25 selected": true, and useless. The operator wanted the 300
 * and had no way to ask for them.
 *
 * Two modes, therefore. `explicit` is a set of ids. `matching` means every row
 * the current filter returns, with a set of exclusions — because "all 300
 * except these two" is a thing people genuinely want and cannot be expressed
 * with a set of ids they have never loaded.
 *
 * Kept as pure functions over a plain value so the arithmetic can be tested
 * without a renderer. `useSelection` is a twenty-line wrapper around this.
 */

export type SelectionMode = 'explicit' | 'matching'

export interface SelectionState {
  mode: SelectionMode
  /** Ids explicitly picked, in `explicit` mode. */
  ids: readonly string[]
  /** Ids explicitly unpicked, in `matching` mode. */
  excluded: readonly string[]
}

export const EMPTY_SELECTION: SelectionState = { mode: 'explicit', ids: [], excluded: [] }

export function isSelected(state: SelectionState, id: string): boolean {
  return state.mode === 'matching'
    ? !state.excluded.includes(id)
    : state.ids.includes(id)
}

/**
 * How many rows an action will touch.
 *
 * Never negative. A stale total after a refetch can leave more exclusions than
 * rows, and "−3 selected" on a bulk bar is the sort of thing that makes
 * somebody stop trusting the whole screen.
 */
export function selectionCount(state: SelectionState, total: number): number {
  return state.mode === 'matching'
    ? Math.max(0, total - state.excluded.length)
    : state.ids.length
}

const without = (list: readonly string[], id: string) => list.filter((item) => item !== id)
const withId = (list: readonly string[], id: string) =>
  (list.includes(id) ? list : [...list, id])

export function toggle(state: SelectionState, id: string): SelectionState {
  if (state.mode === 'matching') {
    return {
      ...state,
      excluded: state.excluded.includes(id)
        ? without(state.excluded, id)
        : withId(state.excluded, id),
    }
  }
  return {
    ...state,
    ids: state.ids.includes(id) ? without(state.ids, id) : withId(state.ids, id),
  }
}

/**
 * The header checkbox.
 *
 * In matching mode it excludes or un-excludes the page rather than dropping
 * back to an explicit set — dropping back would silently shrink a 300-row
 * selection to 25, which is the exact surprise this module exists to prevent.
 */
export function togglePage(state: SelectionState, pageIds: readonly string[]): SelectionState {
  if (pageIds.length === 0) return state

  if (state.mode === 'matching') {
    const allExcluded = pageIds.every((id) => state.excluded.includes(id))
    return {
      ...state,
      excluded: allExcluded
        ? state.excluded.filter((id) => !pageIds.includes(id))
        : [...new Set([...state.excluded, ...pageIds])],
    }
  }

  const allSelected = pageIds.every((id) => state.ids.includes(id))
  return {
    ...state,
    ids: allSelected
      ? state.ids.filter((id) => !pageIds.includes(id))
      : [...new Set([...state.ids, ...pageIds])],
  }
}

/** Everything the filter matches, however many pages that is. */
export function selectAllMatching(): SelectionState {
  return { mode: 'matching', ids: [], excluded: [] }
}

/**
 * What the server needs in order to act on this selection.
 *
 * In matching mode it carries the filter rather than the ids, and the server
 * re-runs the query. Sending three hundred ids up a URL works until somebody
 * filters to four thousand.
 */
export interface SelectionRequest {
  mode: SelectionMode
  ids: string[]
  excluded: string[]
}

export function toRequest(state: SelectionState): SelectionRequest {
  return { mode: state.mode, ids: [...state.ids], excluded: [...state.excluded] }
}
