import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

/**
 * Adding a watch from a phone.
 *
 * Alex: "the entire mobile / iPhone duo experience is poor and lacks the
 * efficiency of a modern web app and feels more like a condensed desktop
 * tool. Can you overhaul the key features, search, inventory, sales and
 * adding an item."
 *
 * Measured at 390 wide before touching it: a form 1,977 pixels tall, every
 * field 300 pixels of the 390 available, 14px text in all of them and the
 * only way to save it at the very bottom.
 */
describe('the form that adds a watch', () => {
  it('never puts text under 16px in a control on a phone', () => {
    /*
     * The one Safari rule nobody chose: tap an input whose text is under
     * 16px and iOS zooms the page in to it, and does not zoom back out. The
     * design sets 14px on every control and 13px on the currency selects,
     * so filling in a watch meant the page jumping on the first field and
     * every field after it being typed into at a magnification the layout
     * was never drawn for.
     */
    const css = read('src/styles/globals.css')
    const rule = css.slice(css.indexOf('@media (max-width: 639px)'))
    expect(rule).toMatch(/font-size: 16px/)
    // Weight without `!important`: a bare `input` loses to the `text-body`
    // utility sitting on the element.
    expect(rule).toMatch(/input\[class\]/)
    expect(rule).toMatch(/select\[class\]/)
    expect(rule).toMatch(/textarea\[class\]/)
    // A checkbox has no text to zoom to, and 16px on one would resize it.
    expect(rule).toMatch(/:not\(\[type='checkbox'\]\)/)
  })

  it('keeps the way to save it on the screen', () => {
    /*
     * Twelve fields, then a scroll back past all of them to find the
     * button. A form whose ending you have to go looking for is one people
     * abandon halfway.
     *
     * Fifty-three pixels up, which is what the bottom bar measures, plus
     * whatever the phone reserves under it for the home indicator. Both
     * halves matter: without the bar's height the button hides behind the
     * navigation, and without the inset it hides behind the home bar on
     * the phones that have one.
     */
    const form = read('src/components/inventory/WatchForm.tsx')
    expect(form).toMatch(/sticky bottom-\[calc\(53px\+env\(safe-area-inset-bottom\)\)\] z-10 bg-surface-raised lg:static/)

    // And 53 is the bar, not a number somebody liked: it is fixed to the
    // bottom and that is what it measures.
    const bar = read('src/components/layout/BottomBar.tsx')
    expect(bar).toMatch(/fixed inset-x-0 bottom-0/)
    expect(bar).toMatch(/min-h-\[52px\]/)
    expect(bar).toMatch(/lg:hidden/)
  })
})

/**
 * The gutters every screen is drawn inside.
 */
describe('the shell on a phone', () => {
  it('uses the same gutter as the bar above it', () => {
    /*
     * The content was inset twenty pixels and the header sixteen, so a
     * full-bleed element written to reach the edge — the sticky filter bar,
     * with its -mx-4 — stopped four pixels short on both sides. Sixteen
     * also hands a form field sixteen more pixels to be read in.
     */
    const layout = read('src/app/(app)/layout.tsx')
    expect(layout).toMatch(/flex-1 px-4 py-5 pb-24 outline-none sm:px-5 sm:py-7 lg:px-8 lg:pb-7/)

    const top = read('src/components/layout/TopBar.tsx')
    expect(top).toMatch(/px-4 sm:gap-3 sm:px-5/)

    // Which is what the sticky bar's negative margin assumes.
    const controls = read('src/components/ui/DataList/ListControls.tsx')
    expect(controls).toMatch(/-mx-4 /)
    expect(controls).toMatch(/sm:-mx-5/)
  })

  it('spends less of a card on its own padding', () => {
    // Twenty-four pixels each side, inside the page's own gutters, left a
    // form field 300 pixels of a 390-wide screen.
    const card = read('src/components/ui/Card.tsx')
    expect(card).toMatch(/cn\('px-4 py-5 sm:px-6', className\)/)
    expect(card).toMatch(/px-4 py-5 border-b border-line-subtle sm:px-6/)
    expect(card).toMatch(/px-4 py-4 border-t border-line-subtle sm:px-6/)
  })
})
