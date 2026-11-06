import type { BuiltInView } from '@/components/ui/DataList'

/**
 * The views that ship with the sales ledger.
 *
 * Alex, looking at the Sales page: "Still can't see tabs." The saved-view
 * machinery has accepted `sale` as an object since it was built — enum,
 * label, service, actions, the lot — and no page ever rendered the bar for
 * it, so the feature existed everywhere except on screen.
 *
 * Written as query strings in the same `f=` grammar the filter bar writes,
 * so a view lights up when somebody builds the same filter by hand, and
 * "Save this view" on a hand-built filter produces something that sits
 * beside these rather than underneath them.
 *
 * The split is the one the page already reads by. Its own headline counts
 * three kinds — "11 from stock · 14 brokered · 1 buy-back" — because a
 * month's earnings are thought about that way: what we owned and sold, what
 * we were paid for selling somebody else's, and what the money we lent
 * earned. Those were three numbers you could read and not three lists you
 * could open.
 *
 * Deliberately no "unpaid" or "awaiting despatch" view, tempting as both
 * are. A filter on any field but channel is applied in SQL against the
 * sales table, and the fee ledgers are not in it, so such a view would
 * quietly answer for stock sales only — see feeArms in sales-ledger. A
 * built-in that is wrong about a third of the ledger is worse than one
 * somebody builds themselves and knows the shape of.
 */
export const SALES_VIEWS: readonly BuiltInView[] = [
  {
    /*
     * The way back, and the honest default.
     *
     * An empty query rather than a filter that happens to match
     * everything: the bar compares the URL to a view's query as a set, so
     * this is the chip that lights up when nothing is filtered — which is
     * how the page opens.
     */
    id: 'all',
    label: 'Everything',
    query: '',
    description: 'Every sale, fee and charge — the whole ledger',
  },
  {
    /*
     * Watches we owned. Written as "not the two fee kinds" rather than as
     * a list of the real channels, so a channel added later lands in the
     * stock list instead of quietly falling out of every view — the same
     * reasoning as `isNot SOLD` on the stock list.
     */
    id: 'stock',
    label: 'From stock',
    query: 'f=channel%3AisNot%3ACOMMISSION%7CBUYBACK',
    description: 'Watches we owned and sold — the only rows with a cost under them',
  },
  {
    id: 'commission',
    label: 'Commission',
    query: 'f=channel%3Ais%3ACOMMISSION',
    description: 'Fees earned selling somebody else’s watch. No cost, so no margin',
  },
  {
    id: 'buyback',
    label: 'Buy-backs',
    query: 'f=channel%3Ais%3ABUYBACK',
    description: 'Interest and extension fees on money lent',
  },
]
