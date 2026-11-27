import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatCurrency } from '@/lib/currency'
import { formatMoney } from '@/lib/money'

const read = (path: string) => readFileSync(path, 'utf8')
const NBSP = ' '

/**
 * Money on a narrow screen.
 *
 * Alex, from a phone: "Can't view pricing and product tiles properly on
 * mobile", with a screenshot of stock tiles reading "AED 6" and "AED 80"
 * where prices should be, and stat cards whose figures ran off the edge.
 *
 * One character caused it. Intl puts a non-breaking space between a currency
 * and its number, which is right nearly everywhere and wrong in a 140-pixel
 * box: the figure becomes a single token wider than its container, and a
 * token that cannot break does not wrap — it overflows, and a card with
 * `overflow-hidden` cuts it in half. "AED 3,290,80" is worse than no figure
 * at all, because it still looks like one.
 */
describe('a price in a narrow box', () => {
  it('can break between the currency and the number', () => {
    const aed = formatCurrency(369541500, 'AED')
    expect(aed).toBe('AED 3,695,415')
    expect(aed).not.toContain(NBSP)

    // Both formatters, because the application uses both and a figure that
    // wraps on one screen and is cut in half on the next is worse than
    // either behaviour applied consistently.
    expect(formatMoney(1310651, 'GBP')).not.toContain(NBSP)
    expect(formatCurrency(500000, 'HKD')).not.toContain(NBSP)
  })

  it('still formats the figure exactly as before', () => {
    // Only the space changed. The rounding, the grouping, the currency and
    // the symbol are all untouched.
    expect(formatCurrency(369541500, 'AED').replace(' ', NBSP)).toBe(`AED${NBSP}3,695,415`)
    expect(formatCurrency(123456, 'GBP')).toBe('£1,235')
    expect(formatCurrency(123456, 'GBP', { decimals: true })).toBe('£1,234.56')
    expect(formatCurrency(null, 'AED')).toBe('—')
  })

  it('lets a stock tile put its price under the status rather than beside it', () => {
    /*
     * Two cards to a 390-pixel row leaves each about 160 wide, and a status
     * chip beside "AED 620,000" wants more than that. Letting the figure
     * break was not enough on its own: squeezed next to the chip it went to
     * two lines each and was still clipped. The row has to be able to wrap.
     */
    const gallery = read('src/components/inventory/InventoryGallery.tsx')
    const metaRow = gallery.slice(gallery.indexOf('mt-auto flex'))
    expect(metaRow).toMatch(/mt-auto flex flex-wrap/)
    // And the price column takes the rest of the line, so it stays
    // right-aligned whether it sits beside the chip or beneath it.
    expect(gallery).toMatch(/flex flex-1 flex-col items-end/)
  })

  it('gives a stat card the whole row on a phone', () => {
    /*
     * Alex again, with AED 28,727,500 and AED 25,471,707 running off their
     * cards: "Again can't view these figures very accurately, presented off
     * screen."
     *
     * Two cards to a 390-pixel row leaves each about 140 inside its padding,
     * and "+AED 26,326,430" wants about 190 at any size somebody would call
     * a headline figure. Shrinking it far enough would have put the figure
     * at 15px against a 12px label, which is not a headline. So one to a row
     * until there is room for two.
     */
    const card = read('src/components/ui/Card.tsx')
    const grid = card.slice(card.indexOf('export function StatGrid'), card.indexOf('export function StatCard'))
    expect(grid).toMatch(/min-\[520px\]:grid-cols-2/)
    /*
     * And no bare one left beside it. Written as a lookahead first, which
     * matched the very string it was meant to exempt — `.` does not cross a
     * newline, so "grid-cols-2'," read as unprefixed and the guard passed
     * for the wrong reason.
     */
    const bare = [...grid.matchAll(/(.{0,12})grid-cols-2/g)]
      .filter((match) => !match[1].endsWith('min-[520px]:'))
    expect(bare).toEqual([])
  })

  it('is the only place that breakpoint is written', () => {
    /*
     * The class string it replaces was copied onto four pages, and the fifth
     * would have been written without the breakpoint — which is exactly how
     * the rule for held-away stock came to be missing from two queries.
     */
    const pages = [
      'src/app/(app)/inventory/page.tsx',
      'src/app/(app)/sales/page.tsx',
      'src/app/(app)/reports/page.tsx',
      'src/app/(app)/inventory/[id]/page.tsx',
    ]
    for (const page of pages) {
      const text = read(page)
      expect(text).toContain('<StatGrid')
      expect(text).not.toContain('grid grid-cols-2 gap-3 sm:gap-6')
    }
  })

  it('keeps a seven-figure price inside its table column', () => {
    /*
     * A Richard Mille at "AED 1,200,000" wants 96 pixels and a 120px column
     * gives it 88, so the expensive stock was clipped on every screen while
     * a Submariner fitted — the wrong way round. And on Sales, the margin
     * column gave "↓ AED 184,652 vs est." 98 pixels for a line needing 121.
     */
    const list = read('src/components/inventory/InventoryList.tsx')
    expect(list).toMatch(/cost: 136, trade: 136, estSale: 136, profit: 144/)
    const sales = read('src/components/sales/SalesTable.tsx')
    expect(sales).toMatch(/width="164px"[^>]*sortKey="margin"/)
  })

  it('keeps a stat figure at full size and reads down the card', () => {
    /*
     * Full size at every width, because the card always has room for it now:
     * one of a swipeable strip on a phone at 78% of the screen, a grid cell
     * from 520 up.
     *
     * And down rather than across. Laid across for a moment, while the cards
     * were full width and stacked — but in the strip the card at the edge is
     * deliberately half visible, and a right-aligned figure on it fell off
     * the screen, so the card peeking in showed a label and a caption with
     * no number between them.
     */
    const card = read('src/components/ui/Card.tsx')
    const stat = card.slice(card.indexOf('export function StatCard'))
    expect(stat).toMatch(/mt-2 text-h3 font-extrabold tabular-nums sm:text-h2/)
    expect(stat).not.toMatch(/text-right/)
  })
})

/**
 * Finding a watch on a phone.
 *
 * Alex, searching a reference: "Very poor mobile search functionality, can't
 * see images or view all just can click 1 watch only and hard to tell which
 * watch it is the way it's built" — with five results reading "Rolex
 * 126500..." over "Stock 1722 · seri...".
 *
 * Three faults in one row: no photograph, a serial cut off mid-word, and no
 * way past the five the palette shows.
 */
describe('searching for a watch on a phone', () => {
  const palette = read('src/components/layout/CommandPalette.tsx')
  const screen = read('src/components/search/SearchScreen.tsx')
  const repo = read('src/server/repositories/search-repository.ts')

  it('fetches a photograph with each watch', () => {
    // A dealer recognises a watch by its picture long before its serial.
    expect(repo).toMatch(/AS image_id/)
    expect(repo).toMatch(/imageId: row\.image_id/)
  })

  it('shows it, on both search surfaces', () => {
    for (const source of [palette, screen]) {
      expect(source).toMatch(/\/api\/images\/\$\{[^}]*imageId\}/)
    }
  })

  it('keeps the serial whole on a narrow screen', () => {
    /*
     * "Stock 1722 · seri…" identifies nothing, and the serial is the entire
     * difference between two of the same reference. It may wrap; it may not
     * be cut.
     */
    expect(palette).toMatch(/block text-caption text-content-secondary sm:truncate/)
    expect(screen).not.toMatch(/block truncate text-caption text-content-secondary/)
  })

  it('offers the full list once a group is capped', () => {
    // The palette stops at five of each kind and used to stop silently,
    // which reads as "that is all there is".
    for (const source of [palette, screen]) {
      expect(source).toMatch(/See every \{?/)
      expect(source).toMatch(/href: '\/inventory'/)
      /*
       * The condition, not just the words. Written as a check that the file
       * contains "PER_KIND" first, which passed happily while the branch
       * around it was disabled — a guard that reads a string in a dead
       * branch is a guard that reads nothing.
       */
      expect(source).toMatch(/group\.length >= PER_KIND/)
    }
  })

  it('does not advertise keys to a screen with no keyboard', () => {
    // Four shortcuts and an Esc were two lines of advice nobody on a phone
    // can take, taken off the results.
    expect(palette).toMatch(/hidden flex-wrap items-center[^"]*sm:flex/)
    expect(palette).toMatch(/hidden shrink-0 text-micro text-content-secondary sm:inline/)
  })
})

/**
 * The controls above a list, on a phone.
 *
 * Alex: "This whole search and filtering on mobile is awful and takes up so
 * much space - doesn't feel like a web app feels likes a clunky old tool."
 *
 * Measured before touching it: 1,361 pixels of chrome between opening the
 * stock list and seeing a watch, which on a 390-wide phone is one and a half
 * screens of scrolling to reach the thing the page is for.
 */
describe('the controls above the stock list', () => {
  const controls = read('src/components/ui/DataList/ListControls.tsx')
  const page = read('src/app/(app)/inventory/page.tsx')

  it('folds the views, filters and facets behind one button on a phone', () => {
    expect(page).toContain('<ListControls')
    // The real components, not a second set built for the phone.
    expect(page).toContain('<ViewBar')
    expect(page).toContain('<FilterBar')
    expect(page).toContain('<FindBar')
  })

  it('renders them once, not once per breakpoint', () => {
    /*
     * Written first as a mobile copy and a desktop copy, which is two filter
     * bars both writing the query string. Hidden with a class instead, so
     * there is one of each and the URL has one author.
     */
    expect(controls.match(/\{children\}/g) ?? []).toHaveLength(1)
  })

  it('says how many filters are on, since they are now out of sight', () => {
    // A filter you cannot see is a filter you forget you set, and "198
    // watches" with no visible reason is how somebody concludes the stock
    // has gone missing.
    expect(controls).toMatch(/const active = useMemo/)
    expect(controls).toMatch(/\{active\}/)
  })

  it('writes the search in an effect, not while rendering', () => {
    // Navigating during render works until it loops.
    const write = controls.slice(controls.indexOf('const debounced'))
    expect(write).toMatch(/useEffect\(\(\) => \{[\s\S]*?write\(next\)/)
  })

  it('leaves one search box on screen, not two', () => {
    // Two inputs for one query string means whichever somebody types into
    // second appears to lose what they typed into the first.
    const bar = read('src/components/ui/DataList/FilterBar.tsx')
    expect(bar).toMatch(/relative hidden min-w-\[240px\] flex-1 lg:block/)
  })

  it('keeps the search box on screen while the list scrolls', () => {
    /*
     * Alex: "Filter and search on inventory should be sticky when scrolling."
     *
     * Forty rows down a stock list the control that narrows it was four
     * hundred pixels above the fold, so the way to search was to scroll to
     * the top, search, and lose your place.
     *
     * Sixty pixels down because the header is `top-0` and `h-[60px]`; below
     * its z-30 so a menu opening out of the header still covers this bar.
     * Both numbers are read off the header here rather than trusted, because
     * a bar pinned to the wrong offset either hides under the header or
     * leaves a gap of list showing through above it.
     */
    expect(controls).toMatch(/sticky top-\[60px\] z-20/)

    const shell = read('src/components/layout/TopBar.tsx')
    expect(shell).toMatch(/sticky top-0/)
    expect(shell).toMatch(/h-\[60px\]/)
    expect(shell).toMatch(/z-30/)
  })

  it('makes the figures a strip to swipe rather than a screen to scroll', () => {
    // Six cards stacked ran to 560 pixels and put the stock below the fold.
    const card = read('src/components/ui/Card.tsx')
    const grid = card.slice(card.indexOf('export function StatGrid'), card.indexOf('export function StatCard'))
    expect(grid).toMatch(/snap-x snap-mandatory/)
    expect(grid).toMatch(/overflow-x-auto/)
    expect(grid).toMatch(/min-\[520px\]:grid/)
  })
})

