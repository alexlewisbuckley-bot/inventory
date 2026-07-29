import { describe, expect, it } from 'vitest'
import {
  EMPTY_SELECTION, isSelected, selectAllMatching, selectionCount, toggle,
  togglePage, toRequest, type SelectionState,
} from '@/lib/selection'

/**
 * Selection across pages.
 *
 * The behaviour worth testing is the mode switch, not the set arithmetic. The
 * fault this replaces was subtle and lived a long time: `⌘A` on a filtered
 * list of 300 selected the 25 rows on screen, the bar said "25 selected", and
 * both statements were true. The operator wanted the 300.
 */

const TOTAL = 300
const count = (state: SelectionState) => selectionCount(state, TOTAL)

describe('selection', () => {
  it('starts empty', () => {
    expect(count(EMPTY_SELECTION)).toBe(0)
    expect(isSelected(EMPTY_SELECTION, 'a')).toBe(false)
  })

  it('counts individual picks', () => {
    let state = toggle(EMPTY_SELECTION, 'a')
    state = toggle(state, 'b')
    expect(count(state)).toBe(2)
    expect(isSelected(state, 'a')).toBe(true)
    expect(isSelected(state, 'c')).toBe(false)

    state = toggle(state, 'a')
    expect(count(state)).toBe(1)
  })

  it('selects everything the filter matches, not everything on the page', () => {
    const state = selectAllMatching()
    expect(count(state)).toBe(300)
    // A row it has never loaded is still selected — which is the whole point.
    expect(isSelected(state, 'row-on-page-11')).toBe(true)
  })

  it('subtracts exceptions from a whole-result selection', () => {
    // "All 300 except these two" is a real thing people want, and it cannot be
    // expressed with a set of ids they have never loaded.
    let state = selectAllMatching()
    state = toggle(state, 'x')
    state = toggle(state, 'y')
    expect(count(state)).toBe(298)
    expect(isSelected(state, 'x')).toBe(false)
    expect([...state.excluded].sort()).toEqual(['x', 'y'])
  })

  it('never lets a page checkbox shrink a whole-result selection', () => {
    // Ticking the header checkbox while 300 are selected must not quietly drop
    // to the 25 on screen. That is the surprise this module exists to prevent.
    let state = selectAllMatching()
    state = togglePage(state, ['a', 'b', 'c'])
    expect(state.mode).toBe('matching')
    expect(count(state)).toBe(297)

    state = togglePage(state, ['a', 'b', 'c'])
    expect(count(state)).toBe(300)
  })

  it('toggles a whole page on and off in explicit mode', () => {
    let state = togglePage(EMPTY_SELECTION, ['a', 'b', 'c'])
    expect(count(state)).toBe(3)
    state = togglePage(state, ['a', 'b', 'c'])
    expect(count(state)).toBe(0)
  })

  it('adds to a partial page selection rather than clearing it', () => {
    // Two of three ticked, then the header: the intent is "all of them", not
    // "undo the two I picked".
    let state = toggle(EMPTY_SELECTION, 'a')
    state = togglePage(state, ['a', 'b', 'c'])
    expect(count(state)).toBe(3)
  })

  it('ignores an empty page', () => {
    expect(togglePage(EMPTY_SELECTION, [])).toEqual(EMPTY_SELECTION)
  })

  it('never reports a negative count', () => {
    // More exclusions than rows should not happen, but a stale total after a
    // refetch produces it, and "−3 selected" on a bulk bar is the sort of
    // thing that makes somebody stop trusting the whole screen.
    let state = selectAllMatching()
    for (const id of ['a', 'b', 'c']) state = toggle(state, id)
    expect(selectionCount(state, 2)).toBe(0)
  })

  it('never duplicates an id', () => {
    let state = togglePage(EMPTY_SELECTION, ['a', 'b'])
    state = togglePage(state, ['b', 'c'])
    expect(new Set(state.ids).size).toBe(state.ids.length)
  })

  it('tells the server which question to ask', () => {
    // In matching mode the server re-runs the filter rather than being handed
    // ids: sending three hundred up a URL works until somebody filters to four
    // thousand.
    const explicit = toRequest(toggle(EMPTY_SELECTION, 'a'))
    expect(explicit).toEqual({ mode: 'explicit', ids: ['a'], excluded: [] })

    const matching = toRequest(toggle(selectAllMatching(), 'a'))
    expect(matching).toEqual({ mode: 'matching', ids: [], excluded: ['a'] })
  })

  it('leaves the state it was given alone', () => {
    // Every operation returns a new value. A mutation here would make React
    // skip the re-render and leave the checkbox looking unticked.
    const original = toggle(EMPTY_SELECTION, 'a')
    const snapshot = JSON.stringify(original)
    toggle(original, 'b')
    togglePage(original, ['c'])
    expect(JSON.stringify(original)).toBe(snapshot)
  })
})
