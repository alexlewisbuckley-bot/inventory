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

/** Its opposite, written once so the chip and the page agree on it. */
export const SOLD_QUERY = 'f=status%3Ais%3ASOLD'

/** Available stock standing in one place. */
export function locationQuery(locationId: string): string {
  return `${AVAILABLE_QUERY}&f=${encodeURIComponent(`locationId:is:${locationId}`)}`
}

/**
 * The two views a location's own page has.
 *
 * Alex, looking at a sold Richard Mille still standing in "In transit": "If
 * sold remove from location and move out from view."
 *
 * So the page opens on what is actually there. The second chip exists
 * because taking sold stock off this page takes it off the last list that
 * showed it: stock held away is not on the main stock list at all, so its
 * "Sold" view cannot answer "what went out of Hong Kong this year" either.
 * Hidden rather than deleted is only honest if there is a way back to it.
 *
 * Nothing about where the stock is, because this page already knows: the
 * location is fixed by the route and cannot be argued with from the URL.
 */
export function locationViews(): readonly BuiltInView[] {
  return [
    {
      id: 'here',
      label: 'Here now',
      query: AVAILABLE_QUERY,
      description: 'What is standing in this location',
    },
    {
      id: 'sold',
      label: 'Sold from here',
      query: SOLD_QUERY,
      description: 'What has left — the money is on the sales ledger',
    },
  ]
}

/**
 * The views, which no longer include one about where the stock is.
 *
 * There was a "Stock to hand" chip here, carrying a clause that excluded the
 * locations marked away. Alex, a day later: "if you make a way to hide from
 * inventory (main dashboard) but trackable only from locations that will be
 * better so it doesn't show the filter toggle at all and the only way to view
 * them is through the location itself."
 *
 * He is right, and it is a different promise rather than a tidier version of
 * the same one. A filter is the list doing something for you that it will
 * stop doing if you ask — so "All locations" sat one click away, offering
 * exactly the stock he had just said should not be there. Hiding it in the
 * repository means there is nothing to switch off, nothing to forget is
 * switched on, and no chip to explain.
 *
 * `queues` is what separates selling from running the shop. Every view here
 * widens the list past the stock standing in the shop: sold stock, and the
 * four administrative queues — unpriced, register checks, thin records,
 * ageing. None of those is a salesperson's job, and the bar was offering all
 * of them to a role whose work is the shelf in front of them. Turned off,
 * there is no bar at all.
 */
export function inventoryViews(
  { queues = true }: { queues?: boolean } = {},
): readonly BuiltInView[] {
  return queues ? INVENTORY_VIEWS : []
}

export const INVENTORY_VIEWS: readonly BuiltInView[] = [
  {
    id: 'all',
    label: 'Stock you hold',
    /*
     * Not "All locations" any more, because it is not all of them: stock
     * standing somewhere marked away is off this list entirely and is looked
     * at through that location. A chip promising everything, over a list that
     * is missing five watches, is the one thing worse than not offering it.
     */
    query: AVAILABLE_QUERY,
    description: 'Everything on the books here — stock held away is on its location',
  },
  {
    id: 'sold',
    label: 'Sold',
    query: SOLD_QUERY,
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
