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
    id: 'unpriced',
    label: 'Needs a price',
    query: 'f=estSaleGbp%3AisEmpty&f=status%3Ais%3AIN_STOCK%7CRESERVED',
    description: 'Invisible to margin forecasting until priced',
  },
  {
    id: 'agreed',
    label: 'Sale agreed',
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
