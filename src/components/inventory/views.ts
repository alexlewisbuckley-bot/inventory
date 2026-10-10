import { HELD_STATUSES, MISSING_FACTS } from '@/lib/enums'
import type { QuickFilter } from '@/components/ui/DataList'
import type { BuiltInView } from '@/components/ui/DataList'

/**
 * The views that ship with the stock list.
 *
 * Written as query strings rather than as objects, because a query string is
 * what a view *is* now: the same representation the URL carries and the same
 * one a saved view stores. Anything somebody builds and saves sits beside
 * these rather than underneath them.
 *
 * Two of them carry the weight. Stock you hold is the list you work from all
 * day; sold is the record you look things up in. The rest are queues — jobs
 * with an end — so they sit after the two that never empty.
 */

/**
 * Everything except sold, as a filter rather than as a hidden default.
 *
 * `isNot SOLD` rather than naming the statuses you want, so a status added
 * later shows up in the stock list instead of quietly falling out of it. It
 * keeps returned and written-off stock visible too: they are not available to
 * sell, but they are things you still have to be able to find, and no other
 * view would show them.
 */
export const AVAILABLE_QUERY = 'f=status%3AisNot%3ASOLD'

export const INVENTORY_VIEWS: readonly BuiltInView[] = [
  {
    id: 'all',
    label: 'All stock (available)',
    query: AVAILABLE_QUERY,
    description: 'Everything you hold — sold stock has its own view',
  },
  {
    id: 'sold',
    label: 'Sold',
    query: 'f=status%3Ais%3ASOLD',
    description: 'Completed sales',
  },
  {
    // Stock you hold, all three statuses of it. This was IN_STOCK|RESERVED,
    // which quietly hid a deposit-taken watch nobody had ever priced from the
    // only list that would have caught it.
    id: 'unpriced',
    label: 'Needs a price',
    query: 'f=estSaleGbp%3AisEmpty&f=status%3Ais%3AIN_STOCK%7CRESERVED%7CSALE_AGREED',
    description: 'Invisible to margin forecasting until priced',
  },
  {
    id: 'agreed',
    label: 'Deposit taken',
    query: 'f=status%3Ais%3ASALE_AGREED',
    description: 'Committed but not yet completed',
  },
  {
    // The register-check queue. Live stock only: a watch that has already been
    // sold is somebody else's to worry about, and leaving them in makes a list
    // nobody can ever clear.
    id: 'register-due',
    label: 'Register check due',
    query: 'f=registerCheckStatus%3Ais%3AUNCHECKED&f=status%3Ais%3AIN_STOCK%7CRESERVED%7CSALE_AGREED',
    description: 'Not yet searched against The Watch Register',
  },
  {
    /**
     * The record-keeping queue: a watch we hold that cannot answer one of the
     * three questions a record exists to answer — whose it is, which one it
     * is, and how it can be sold. Everything else about a thin record is
     * marketing; these three each stop something, and all three are usually
     * missing on the same watch, because they are what gets skipped when
     * stock is booked in at speed.
     */
    id: 'incomplete',
    label: 'Missing key details',
    query: `f=missing%3Ais%3A${MISSING_FACTS.join('%7C')}&f=status%3Ais%3A${HELD_STATUSES.join('%7C')}`,
    description: 'No owner, no serial or no VAT scheme recorded',
  },
  {
    id: 'ageing',
    label: 'Ageing',
    query: 'f=status%3Ais%3AIN_STOCK%7CRESERVED&sort=purchaseDate&dir=asc',
    description: 'Oldest holdings first',
  },
]

/**
 * The statuses that count as stock you hold.
 *
 * The same three the owner and location cards count and value. A link from
 * one of those cards that showed a different set would hand somebody a list
 * that disagrees with the number they just clicked, which reads as the count
 * being wrong rather than the link being loose. Stated once in `enums`, where
 * the server can read it too, and re-exported here so the views that have
 * always imported it from this module still can.
 */
export { HELD_STATUSES }

/**
 * "Show me what this owner / location / supplier is holding."
 *
 * Built as filter clauses rather than as the bare `?ownerId=` these links used
 * to carry. That shape filtered nothing at all for owners — the parameter was
 * never read — and for the others filtered without appearing anywhere on the
 * toolbar, so the list narrowed with no chip to say why and nothing to click
 * to widen it again. A clause is the one representation the whole list
 * understands: the query runs it, the chip shows it, and removing the chip
 * removes it.
 */
export function heldByQuery(field: 'ownerId' | 'locationId' | 'supplierId', id: string): string {
  const params = new URLSearchParams()
  params.append('f', `status:is:${HELD_STATUSES.join('|')}`)
  params.append('f', `${field}:is:${id}`)
  return params.toString()
}

/**
 * The three questions the stock list is actually asked at the counter.
 *
 * "Have you anything for my wife, around ten thousand?" is one sentence and
 * was four trips through the filter menu. Everything here was already
 * askable — `+ Filter` can express all of it — but a filter you have to
 * assemble while somebody waits is a filter nobody uses, and the answer gets
 * given from memory instead, which is how a watch sits unsold in a drawer.
 *
 * Budget is stated as a ceiling rather than a band. Nobody says "between ten
 * and twenty-five"; they say "about twenty" and mean "not much over". The
 * four ceilings are one control, not four — they share a field and an
 * operator, so picking one replaces the last (see toggleQuick) — and they
 * compose with the two on the left, which is the whole point of their being
 * toggles rather than views.
 *
 * Priced in base currency, which is what the figures underneath are kept in.
 */
const BUDGETS = [5_000, 10_000, 25_000, 50_000] as const

export const INVENTORY_QUICK_FILTERS: readonly QuickFilter[] = [
  { id: 'womens', label: "Women's", clause: { field: 'wears', operator: 'is', values: ['WOMENS'] } },
  { id: 'mens', label: "Men's", clause: { field: 'wears', operator: 'is', values: ['MENS'] } },
  ...BUDGETS.map((amount) => ({
    id: `under-${amount}`,
    label: `Up to £${(amount / 1000)}k`,
    // `lt` on Retail, in pounds — the grammar converts to pence. Stock with
    // no asking price has no budget and drops out, which is right: you
    // cannot offer somebody a watch you have not priced.
    clause: { field: 'estSaleGbp', operator: 'lt' as const, values: [String(amount)] },
  })),
]
