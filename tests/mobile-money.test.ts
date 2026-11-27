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

  it('sizes a stat figure to the card it is in', () => {
    /*
     * "AED 3,695,415" at 21px wants 175 pixels and the card gives it 140, so
     * once it could wrap it broke after "AED" and left the currency stranded
     * on a line of its own. Smaller at phone width, full size from 480 up.
     */
    const card = read('src/components/ui/Card.tsx')
    const stat = card.slice(card.indexOf('export function StatCard'))
    expect(stat).toMatch(/text-body-lg font-extrabold tabular-nums min-\[480px\]:text-h3 sm:text-h2/)
  })
})
