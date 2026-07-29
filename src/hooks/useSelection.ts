'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  EMPTY_SELECTION, isSelected, selectAllMatching, selectionCount, toggle, togglePage,
  toRequest, type SelectionRequest, type SelectionState,
} from '@/lib/selection'

/**
 * The selection value, wired to a component.
 *
 * Everything interesting lives in `src/lib/selection.ts` as pure functions over
 * a plain value; this is the part that holds it in state. The split is
 * deliberate — the arithmetic is what goes wrong, and the arithmetic is what
 * can be tested without a renderer.
 */
export function useSelection(total: number) {
  const [state, setState] = useState<SelectionState>(EMPTY_SELECTION)

  const count = useMemo(() => selectionCount(state, total), [state, total])

  return {
    state,
    count,
    empty: count === 0,
    isAllMatching: state.mode === 'matching',
    isSelected: useCallback((id: string) => isSelected(state, id), [state]),
    toggle: useCallback((id: string) => setState((current) => toggle(current, id)), []),
    togglePage: useCallback(
      (ids: readonly string[]) => setState((current) => togglePage(current, ids)),
      [],
    ),
    selectAllMatching: useCallback(() => setState(selectAllMatching()), []),
    clear: useCallback(() => setState(EMPTY_SELECTION), []),
    request: useMemo<SelectionRequest>(() => toRequest(state), [state]),
  }
}
