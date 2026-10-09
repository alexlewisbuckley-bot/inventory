import { HELD_STATUSES } from '@/lib/enums'
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
