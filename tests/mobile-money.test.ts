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

  it('sizes a stat figure to the card it is in', () => {
    /*
     * Full size at every width, now that it has the row to itself: laid
     * across on a phone — label left, figure right where the eye goes for a
     * number — and back into a column from 520 up.
     */
    const card = read('src/components/ui/Card.tsx')
    const stat = card.slice(card.indexOf('export function StatCard'))
    expect(stat).toMatch(/text-h3 font-extrabold tabular-nums min-\[520px\]:mt-2 min-\[520px\]:text-left sm:text-h2/)
  })
})
