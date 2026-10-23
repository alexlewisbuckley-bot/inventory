/**
 * What kind of thing earned the money on a ledger row.
 *
 * A sale is a watch of ours leaving the building. A commission is a fee on
 * somebody else's. A buy-back charge is interest or an extension fee on
 * money we lent against watches we are holding.
 *
 * Here rather than beside the query, because the table is a client
 * component and importing anything under `@/server` into it pulls the
 * database driver into the browser bundle.
 */
export type LedgerKind = 'SALE' | 'COMMISSION' | 'BUYBACK'

/**
 * Is there stock behind this row?
 *
 * Two of the three kinds have no watch of ours under them, which is one
 * fact with four consequences on the screen: no stock number, no record to
 * open, no cost, and a margin that is undefined rather than total. Named
 * once so the four stay in step — they drifted apart the last time a kind
 * was added, and a commission briefly offered the verbs of a sale.
 */
export function stockless(row: { kind?: LedgerKind }): boolean {
  return row.kind === 'COMMISSION' || row.kind === 'BUYBACK'
}
