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

  it('gives a stock tile\'s price the whole width of the card', () => {
    /*
     * Two cards to a 390-pixel row leaves each about 160 wide, and the
     * status chip that used to sit beside "AED 620,000" wanted more than
     * was left: squeezed next to it the figure went to two lines and was
     * still clipped.
     *
     * The chip is a dot in the card's header now, so nothing competes with
     * the figure for the line — but the line can still hold two things, the
     * asking price and the trade price beside it, so it must be able to
     * wrap rather than run off the edge.
     */
    const gallery = read('src/components/inventory/InventoryGallery.tsx')
    const metaRow = gallery.slice(gallery.indexOf('mt-auto flex'))
    expect(metaRow).toMatch(/mt-auto flex flex-col items-start/)
    expect(metaRow).toMatch(/flex flex-wrap items-baseline/)
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

  it('says only "Search" in a box 240 pixels wide', () => {
    /*
     * Alex: "Change search placeholder to fit within search panel just
     * replace with search." The descriptive line the wide screen's box
     * carries — "Search by stock number, model, reference or serial…" —
     * arrived on a phone as "Search by stock n", which lists nothing and
     * reads like a sentence somebody cut off.
     *
     * The full line stays as the box's accessible name, so a screen reader
     * still hears what can be searched.
     */
    expect(controls).toMatch(/placeholder="Search"/)
    expect(controls).toMatch(/<span className="sr-only">\{search\}<\/span>/)
  })

  it('colours the Filters button in the brand, not in a shade of the page', () => {
    /*
     * Alex: "Replace filter color from grey so it's more visible / sleek
     * and inline with brand."
     *
     * It was `navy-700`, the deep ink of the light palette — but that token
     * inverts to #D9D3C8 in dark mode, so the one control meant to stand
     * out when filters are on came out a flat beige slab, lighter than the
     * page behind it and louder than the Add item button beside it. Sage is
     * the accent the rest of the product acts in, and it reads as "on" at
     * both themes because it is a colour rather than a shade of the
     * background.
     */
    expect(controls).toMatch(/border-teal-500 bg-teal-500 text-content-on-accent/)
    expect(controls).not.toMatch(/bg-navy-700/)

    // The same pair the primary button uses, so the two agree on screen.
    const button = read('src/components/ui/Button.tsx')
    expect(button).toMatch(/primary: 'bg-teal-500 text-content-on-accent/)
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

/**
 * The sales ledger on a phone.
 *
 * Alex: "the entire mobile / iPhone duo experience is poor and lacks the
 * efficiency of a modern web app and feels more like a condensed desktop
 * tool. Can you overhaul the key features, search, inventory, sales and
 * adding an item."
 *
 * Measured at 390 wide before touching it: 299 elements of this page sat
 * past the right edge of the screen, the worst of any screen in the
 * application. The table is 1,412 pixels where it is complete, so the sales
 * list on a phone was a date and half an invoice number, with the profit
 * four screens of sideways scrolling away.
 */
describe('the sales ledger on a phone', () => {
  const table = read('src/components/sales/SalesTable.tsx')
  const page = read('src/app/(app)/sales/page.tsx')

  it('folds its three bars of controls behind one button', () => {
    // Views, a date range and the filter bar: three glanceable rows on a
    // wide screen, most of a screen before the first sale on a phone.
    const controls = page.slice(page.indexOf('<ListControls'), page.indexOf('</ListControls>'))
    expect(controls).toContain('<ViewBar')
    expect(controls).toContain('<SalesFilterBar')
    expect(controls).toContain('<FilterBar')
  })

  it('renders the rows as cards below sm, and the table above it', () => {
    expect(table).toMatch(/<ul className="divide-y divide-line-subtle sm:hidden">/)
    // And the table genuinely out of the way, not merely scrolled off: a
    // table still in the layout is what put 299 elements past the edge.
    expect(table).toMatch(/<div className="hidden sm:block">\n\s*{\/\* Fixed/)
  })

  it('wires the row menu once, for both renderings', () => {
    /*
     * The menu carries a hundred lines of callbacks — correct, void, link a
     * watch, turn a commission back into a sale. Copied for the phone, the
     * copy is where a verb goes missing, so both call one builder.
     */
    expect(table.match(/<RowActions/g) ?? []).toHaveLength(1)
    expect(table).toMatch(/const actionsFor = /)
    expect(table.match(/actionsFor\(sale\)/g) ?? []).toHaveLength(2)
  })

  it('shows what the card is for: the money, and whether it is in', () => {
    const card = table.slice(table.indexOf('sm:hidden'), table.indexOf('<div className="hidden sm:block">'))
    expect(card).toContain('money(sale.amountGbp)')
    expect(card).toContain('signed(sale.profitGbp)')
    // The flags are computed the same way as the table's, not re-derived.
    expect(card).toContain('flagsOf(sale)')
    expect(card).toContain('PAYMENT_STATUS_LABELS[sale.paymentStatus]')
  })
})

/**
 * The furniture at the top of every screen.
 */
describe('a page heading on a phone', () => {
  it('steps down a size, and keeps the one the wide screen had', () => {
    /*
     * 36px of title, a description, then the actions, then 32 pixels of air:
     * the first 280 pixels of every screen in the product. A desktop heading
     * shrunk to fit is the complaint itself.
     */
    const header = read('src/components/layout/PageHeader.tsx')
    expect(header).toMatch(/text-h2 font-light text-content-primary sm:text-h1/)
    expect(header).toMatch(/className="mb-5 sm:mb-8"/)
  })

  it('fits two ordinary actions on one row', () => {
    /*
     * "Record a commission" and "Export" came to 378 pixels at the desktop
     * padding, twenty more than a 390-wide phone has between its gutters —
     * so every page with two buttons in its header stacked them and spent a
     * hundred and sixty pixels doing it.
     *
     * The height does not move: it is the touch target.
     */
    const button = read('src/components/ui/Button.tsx')
    expect(button).toMatch(/md: 'h-11 px-4 text-\[12px\] gap-2 sm:px-6'/)
    expect(button).toMatch(/sm: 'h-8 px-3 .*sm:px-3\.5'/)
    expect(button).toMatch(/lg: 'h-12 px-5 .*sm:px-8'/)
  })
})

/**
 * The trade price, on a phone.
 *
 * Alex: "You also can't see trade pricing on mobile view - this is info you
 * need very quickly at a glance."
 *
 * It was a column of the desktop stock table and nothing else: not on the
 * phone's card, not on the gallery card, not in the drawer's Financials
 * panel, not on the record page's own summary. So the one figure somebody
 * standing in front of another dealer needs was the one figure a phone could
 * not reach, while the figures a dealer does not quote were on every screen.
 */
describe('what another dealer pays', () => {
  it('is on the phone card, in the order the table puts it in', () => {
    const list = read('src/components/inventory/InventoryList.tsx')
    const card = list.slice(list.indexOf('function MobileRow'), list.indexOf('function Figure'))
    expect(card).toMatch(/label="Cost"/)
    expect(card).toMatch(/label="Trade"/)
    expect(card.indexOf('label="Cost"')).toBeLessThan(card.indexOf('label="Trade"'))
    expect(card.indexOf('label="Trade"')).toBeLessThan(card.indexOf("sold ? 'Sold for' : 'Retail'"))
    // The figure itself, not just the word.
    expect(card).toMatch(/money\(watch\.tradePriceGbp\)/)
    // A watch never offered to the trade says so rather than showing a zero.
    expect(card).toMatch(/watch\.tradePriceGbp !== null/)
  })

  it('keeps four figures two to a line, not four across', () => {
    /*
     * Four across was tried first and measured: 75 pixels a figure, and this
     * business prices in six and seven, so "AED 620,000" broke after the
     * currency on three cards in five. Two across gives 156, which holds an
     * eight-figure price whole, and the label beside the figure rather than
     * above it keeps the card the height it was with three.
     */
    const list = read('src/components/inventory/InventoryList.tsx')
    const card = list.slice(list.indexOf('function MobileRow'), list.indexOf('function Figure'))
    expect(card).toMatch(/<dl className="mt-2\.5 grid grid-cols-2 /)
    expect(card).not.toMatch(/grid-cols-4/)
    // Beside, not above: one flex row per figure.
    const cell = list.slice(list.indexOf('function Figure'))
    expect(cell).toMatch(/flex min-w-0 items-baseline/)
  })

  it('is on the gallery card too, labelled, and only when there is one', () => {
    /*
     * Cost over asking price is a pair anyone reads from position and weight
     * alone; a third unlabelled number between them would be a guess. And a
     * dash on every card would be three cards in four saying nothing.
     */
    const gallery = read('src/components/inventory/InventoryGallery.tsx')
    expect(gallery).toMatch(/!sold && canSeeRevenue && watch\.tradePriceGbp !== null/)
    expect(gallery).toMatch(/Trade \{money\(watch\.tradePriceGbp\)\}/)
  })

  it('is in the drawer and on the record, between cost and retail', () => {
    const drawer = read('src/components/inventory/WatchDrawerClient.tsx')
    const panel = drawer.slice(drawer.indexOf('aria-label="Financials"'))
    expect(panel).toMatch(/label="Trade price"/)
    expect(panel.indexOf('label="Purchase price"')).toBeLessThan(panel.indexOf('label="Trade price"'))
    expect(panel.indexOf('label="Trade price"')).toBeLessThan(panel.indexOf('label="Retail price"'))

    const record = read('src/app/(app)/inventory/[id]/page.tsx')
    const summary = record.slice(record.indexOf('<StatGrid label="Financial summary"'))
    expect(summary).toMatch(/label="Trade price"/)
    expect(summary).toMatch(/Not offered to the trade/)
    // Behind the same permission as the asking price: both are what we sell
    // for, and neither is the cost side.
    const tradeCard = summary.slice(summary.indexOf('label="Trade price"') - 200, summary.indexOf('label="Trade price"'))
    expect(tradeCard).toMatch(/can\(user\.role, 'revenue:read'\)/)
  })
})

/**
 * The gallery card, which is 154 pixels wide on a phone.
 *
 * Alex: "Remove the in stock tag replace much smaller where the amber
 * circle is. Left align the costs and put trade in small to the right of
 * the price."
 */
describe('a watch as a card', () => {
  const gallery = read('src/components/inventory/InventoryGallery.tsx')
  const chip = read('src/components/ui/Chip.tsx')

  it('shows the status as a dot, not a chip', () => {
    // A hundred pixels of a hundred-and-fifty-pixel card, spent saying what
    // nearly every card says.
    expect(gallery).toMatch(/<StatusDot status=\{watch\.status as WatchStatus\} \/>/)
    expect(gallery).not.toMatch(/<StatusChip/)
  })

  it('puts it beside the check light rather than instead of it', () => {
    /*
     * The amber circle was already there and is not the status — it is the
     * supplier's compliance check. Evicting it would have dropped a fact
     * the card is one of two places to see.
     */
    const header = gallery.slice(gallery.indexOf('{watch.stockNo}'), gallery.indexOf('{watch.brandName}'))
    expect(header).toContain('<StatusDot')
    expect(header).toContain('<CheckDot')
    expect(header.indexOf('<StatusDot')).toBeLessThan(header.indexOf('<CheckDot'))
  })

  it('keeps the words on the dot, for a pointer and a screen reader', () => {
    // Colour alone says nothing to somebody who cannot tell these apart, or
    // to anybody reading a printed sheet.
    const dot = chip.slice(chip.indexOf('export function StatusDot'))
    expect(dot).toMatch(/title=\{label\}/)
    expect(dot).toMatch(/className="sr-only">\{label\}/)
    expect(dot).toMatch(/WATCH_STATUS_LABELS\[status\]/)
  })

  it('takes the dot colour from the tone the chip uses', () => {
    /*
     * Keyed by tone, not by status, so a status whose tone changes moves in
     * both places at once — the alternative is a dot that is still amber
     * next to a chip that has gone green.
     */
    expect(chip).toMatch(/const TONE_DOT: Record<ChipTone, string>/)
    expect(chip).toMatch(/TONE_DOT\[WATCH_STATUS_TONE\[status\]\]/)
    // Every tone the chip knows, so the lookup cannot come back undefined.
    const tones = chip.slice(chip.indexOf('const TONES:'), chip.indexOf('export interface ChipProps'))
    const dots = chip.slice(chip.indexOf('const TONE_DOT:'), chip.indexOf('export function StatusDot'))
    const keys = (text: string) => [...text.matchAll(/^ {2}([a-z]+):/gm)].map((m) => m[1]).sort()
    expect(keys(dots)).toEqual(keys(tones))
  })

  it('reads the money down the left edge, with trade beside the price', () => {
    /*
     * Right-aligned it was a column of figures with nothing to start from,
     * each beginning at a different place because each is a different
     * length. And "Trade AED 716,122" next to the asking price is the
     * comparison somebody makes in one look.
     */
    const money = gallery.slice(gallery.indexOf('The money, read down the left edge'))
    expect(money).toMatch(/flex flex-col items-start/)
    expect(money).not.toMatch(/items-end/)
    // Trade is the smaller of the two, and on the same line.
    const priceLine = money.slice(money.indexOf('flex flex-wrap items-baseline'))
    expect(priceLine).toMatch(/text-micro text-content-secondary/)
    expect(priceLine).toMatch(/Trade \{money\(watch\.tradePriceGbp\)\}/)
  })
})

/**
 * Narrowing a list on a phone.
 *
 * Alex: "Filtering is still broken on mobile and very clunky."
 *
 * Broken literally, and measurably clunky: the panel was 462 pixels of
 * controls before the stock came back into view, and opening one of them
 * dragged the whole application sideways.
 */
describe('the filter panel on a phone', () => {
  const find = read('src/components/inventory/FindBar.tsx')
  const views = read('src/components/ui/DataList/ViewBar.tsx')
  const shell = read('src/app/(app)/layout.tsx')

  it('opens a facet as a sheet, not a panel hanging off the right edge', () => {
    /*
     * The panel is 300 wide and was pinned to the left edge of its own
     * pill. The Dial pill starts 116 pixels in, so the panel ended at 416
     * on a 390-wide screen — and nothing clipped it, so the page grew
     * wider than the phone and slid sideways, header and all.
     *
     * Pinned to the viewport it cannot be pushed off the edge by whichever
     * pill it belongs to.
     */
    expect(find).toMatch(/'fixed inset-x-3 bottom-\[calc\(var\(--bottom-bar\)/)
    expect(find).toMatch(/max-h-\[60vh\] overflow-y-auto/)
    // And the wide screen keeps the anchored panel it had.
    expect(find).toMatch(/sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-\[calc\(100%\+6px\)\]/)
    expect(find).toMatch(/sm:w-\[300px\]/)
  })

  it('stands on the same bottom bar as everything else that floats', () => {
    // A sheet that covers the navigation is a sheet you cannot leave.
    for (const path of [
      'src/components/inventory/FindBar.tsx',
      'src/components/inventory/WatchForm.tsx',
      'src/components/inventory/BulkActionBar.tsx',
    ]) {
      expect(read(path)).toContain('var(--bottom-bar)')
    }
  })

  it('clips sideways overflow in both shells, not just the partner one', () => {
    /*
     * The backstop existed and was on the wrong shell. Anything wider than
     * the screen makes a phone widen the whole page to fit it, and every
     * gutter goes with it — which is how one filter panel moved the entire
     * application sideways.
     */
    // The two shell containers by name, not a count of the word: it appears
    // in the comment above each one, so counting it would pass on prose.
    expect(shell).toContain('flex min-h-screen flex-col overflow-x-clip bg-surface-subtle')
    expect(shell).toContain('flex min-h-screen overflow-x-clip bg-surface-subtle')
  })

  it('puts the facets on one line to swipe', () => {
    /*
     * Six facet pills wrapped onto three rows at 136 pixels. Side by side
     * they are 44. A pill keeps its own width in the scroller: a flex
     * child's default is to be squeezed, which would turn six words into
     * six columns of one letter.
     */
    expect(find).toMatch(/-mx-3 mb-\d flex .*overflow-x-auto px-3 pb-1/)
    expect(find).toMatch(/sm:mx-0 sm:flex-wrap sm:overflow-visible/)
    expect(find).toMatch(/\[&>\*\]:shrink-0/)
  })

  it('does not show the views on a phone at all', () => {
    /*
     * Alex: "Put the views on a slider so not taking up so much space or
     * hide them I've never used them before."
     *
     * A slider first, which took eleven chips from five wrapped rows to
     * one line of 40 pixels. The second half of that sentence is the
     * better answer: forty pixels of a control nobody here has ever used
     * is still forty pixels, on the screen with the fewest to spare.
     *
     * Hidden, not unmounted — a saved view applied from a desk still
     * governs the list when the same URL is opened on a phone. What goes
     * away is the row of buttons, not the feature.
     */
    expect(views).toMatch(/className="mb-4 hidden flex-wrap items-center gap-1\.5 sm:flex"/)
    // Still there from sm up, where a tablet and a laptop have the room.
    expect(views).not.toMatch(/sm:hidden/)
  })
})

/**
 * The `+ Filter` menu.
 *
 * Alex: "For filters keep, location, owner, the filters listed below
 * already can be removed and the others hidden with a see more."
 *
 * Fifteen field names in one column, seven of them repeating the facet
 * pills sitting directly underneath, and the two anybody actually reaches
 * for — where a watch stands, and whose it is — somewhere in the middle.
 */
describe('the fields a filter can be added on', () => {
  const find = read('src/components/inventory/FindBar.tsx')
  const bar = read('src/components/ui/DataList/FilterBar.tsx')
  const page = read('src/app/(app)/inventory/page.tsx')

  it('does not offer what the pills underneath already answer', () => {
    expect(page).toMatch(/hide=\{FACET_FIELDS\}/)
    expect(find).toMatch(/export const FACET_FIELDS = \[/)
  })

  it('names exactly the fields those pills write', () => {
    /*
     * The list is declared beside the pills so the two cannot drift, and
     * this is what makes that true: add a pill without naming it here and
     * the menu goes on offering the same filter twice; name one here that
     * no pill answers and the menu quietly loses a field.
     */
    const declared = [...find.slice(find.indexOf('export const FACET_FIELDS'), find.indexOf('] as const'))
      .matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]).sort()
    // Every key the pills read or write, taken from the pills themselves.
    const used = [...new Set(
      [...find.matchAll(/(?:chosen|bound|setRange|toggle)\('([a-zA-Z]+)'/g)].map((m) => m[1]),
    )].sort()
    expect(declared).toEqual(used)
  })

  it('shows the two worth showing, and folds the rest behind one line', () => {
    expect(page).toMatch(/quick=\{\['locationId', 'ownerId'\]\}/)
    expect(bar).toMatch(/const front = quick\?\.length \? addable\.filter/)
    expect(bar).toMatch(/label: `See \$\{rest\.length\} more`/)
    // No "See more" that opens onto nothing.
    expect(bar).toMatch(/!showAll && rest\.length > 0/)
    // And a list that names no favourites still shows everything, which is
    // what Sales and Contacts do.
    expect(bar).toMatch(/quick\?\.length \? addable\.filter\(\(field\) => !quick\.includes\(field\.key\)\) : \[\]/)
  })

  it('leaves the menu open when "See more" is the thing chosen', () => {
    /*
     * An item whose whole job is to lengthen the list it is in has nothing
     * to show for itself if the list closes in the same breath. The menu's
     * dismissal was all-or-nothing before this; now one item can opt out,
     * and only this one does.
     */
    expect(bar).toMatch(/keepOpen: true/)
    const menu = read('src/components/ui/AnchoredMenu.tsx')
    expect(menu).toMatch(/keepOpen\?: boolean/)
    // Both ways in: a tap, and Enter on the highlighted item. Honouring it
    // in one and not the other is a menu that behaves differently for
    // somebody using a keyboard, which is the kind of thing nobody notices
    // until it is the only way they work.
    expect(menu).toMatch(/dismiss === 'on-select' && !item\.keepOpen/)
    expect(menu).toMatch(/dismiss === 'on-select' && !items\[active\]\?\.keepOpen/)
  })

  it('hides those fields from the menu, not from the list', () => {
    // A clause on a hidden field still parses, still shows as a chip and
    // still filters, so a saved view or a shared URL carrying one works.
    const addable = bar.slice(bar.indexOf('const addable = fields.filter'), bar.indexOf('const front ='))
    expect(addable).toMatch(/if \(hide\?\.includes\(field\.key\)\) return false/)
    expect(bar).not.toMatch(/parseFilters\([^)]*hide/)
  })
})
