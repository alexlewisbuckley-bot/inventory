import { HELD_STATUSES, MISSING_FACTS } from '@/lib/enums'
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

/** Available stock standing in one place. */
export function locationQuery(locationId: string): string {
  return `${AVAILABLE_QUERY}&f=${encodeURIComponent(`locationId:is:${locationId}`)}`
}

/**
 * The views, with the house on the front when there is one.
 *
 * The list opens on the stock that is actually in the shop, because that is
 * the question being asked nearly every time somebody opens it: what can I
 * put in front of the person standing here. Everything else — in transit, out
 * on loan, at a workshop — is real stock and a different question.
 *
 * A view and not a hidden default, for the same reason the sold filter is a
 * view: the clause shows as a chip you can take off, the URL still describes
 * what is on the screen, and "All locations" is one click away. A default
 * that narrows the list without saying so is how somebody concludes a watch
 * has gone missing.
 *
 * Which location counts as the house is the first active store in the
 * Locations list, so it follows the order set there rather than a name
 * written into the code.
 *
 * `queues` is what separates selling from running the shop. Every view but
 * the house one widens the list past the stock standing in the shop: other
 * locations, sold stock, and the four administrative queues — unpriced,
 * register checks, thin records, ageing. None of those is a salesperson's
 * job, and the bar was offering all seven of them to a role whose work is
 * the shelf in front of them. Turned off, the bar is the shelf and nothing
 * else.
 *
 * With no house configured and no queues there is no bar at all, which is
 * the honest answer: the one view this role has is defined by a location,
 * and nobody has said which location that is.
 */
export function inventoryViews(
  house: { id: string; name: string } | null,
  { queues = true }: { queues?: boolean } = {},
): readonly BuiltInView[] {
  if (!house) return queues ? INVENTORY_VIEWS : []
  const shelf: BuiltInView = {
    id: 'house',
    label: house.name,
    query: locationQuery(house.id),
    description: `Stock you hold at ${house.name}`,
  }
  return queues ? [shelf, ...INVENTORY_VIEWS] : [shelf]
}

export const INVENTORY_VIEWS: readonly BuiltInView[] = [
  {
    id: 'all',
    label: 'All locations',
    query: AVAILABLE_QUERY,
    description: 'Everything you hold, wherever it is — sold stock has its own view',
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
