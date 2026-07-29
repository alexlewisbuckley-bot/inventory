import type { BuiltInView } from '@/components/ui/DataList'

/**
 * The views that ship with the stock list.
 *
 * Six queries an operator runs most mornings, each of which used to be three
 * or four dropdown interactions rebuilt from memory. They are still here after
 * E6c because a first-run product with no saved views at all would offer an
 * empty row of chips and no hint of what a view is for — but they are no
 * longer the ceiling. Anything somebody builds and saves sits beside them.
 *
 * Written as query strings rather than as objects, because a query string is
 * what a view *is* now: the same representation the URL carries and the same
 * one a saved view stores.
 */
export const INVENTORY_VIEWS: readonly BuiltInView[] = [
  {
    id: 'all',
    label: 'All stock',
    query: '',
    description: 'Everything, including sold',
  },
  {
    id: 'in-stock',
    label: 'In stock',
    query: 'f=status%3Ais%3AIN_STOCK%7CRESERVED',
    description: 'Held and available',
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
    id: 'ageing',
    label: 'Ageing',
    query: 'f=status%3Ais%3AIN_STOCK%7CRESERVED&sort=purchaseDate&dir=asc',
    description: 'Oldest holdings first',
  },
  {
    id: 'sold',
    label: 'Sold',
    query: 'f=status%3Ais%3ASOLD',
    description: 'Completed sales',
  },
]
