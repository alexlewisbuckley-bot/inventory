/**
 * Splitting one Xero invoice across the watches it covers.
 *
 * Alex: "allocate the Xero total across the lines so the sum equals Xero to
 * the cent (put any rounding on the last line)."
 *
 * The cent matters more than it looks. These figures are what the sales
 * ledger, the margin, the commission and the P&L are all built out of, so an
 * invoice that lands as 148,500.00 + 148,500.00 against a Xero total of
 * 297,000.01 leaves a cent that turns up later as a reconciliation that
 * almost works — which is harder to chase than one that plainly does not.
 *
 * So the split is done in minor units, in integers, and the last line is
 * whatever is left rather than its own rounded share. Every other line is
 * rounded normally and the remainder lands once, at the end, where it can be
 * seen.
 */

export interface AllocationLine<T> {
  item: T
  /** What this line is worth before the invoice total is imposed on it. */
  weight: number
}

export interface Allocated<T> {
  item: T
  /** This line's share of the invoice total, in the invoice's minor units. */
  amount: number
}

/**
 * Share `total` out across `lines` in proportion to their weights.
 *
 * Weights are what each sale already says it was for, so a two-watch invoice
 * splits the way the two watches were priced rather than in half. Where
 * every weight is zero — or there is nothing to go on at all — it splits
 * evenly, because an even split is a guess the user can see and correct,
 * whereas putting the whole invoice on the first line looks deliberate.
 *
 * Negative totals (a credit note) are handled by the same arithmetic: the
 * remainder is still whatever the earlier lines did not account for.
 */
export function allocate<T>(total: number, lines: ReadonlyArray<AllocationLine<T>>): Array<Allocated<T>> {
  if (lines.length === 0) return []
  if (lines.length === 1) return [{ item: lines[0]!.item, amount: total }]

  const weights = lines.map((line) => (Number.isFinite(line.weight) ? Math.max(0, line.weight) : 0))
  const sum = weights.reduce((a, b) => a + b, 0)

  const out: Array<Allocated<T>> = []
  let placed = 0
  for (let i = 0; i < lines.length - 1; i += 1) {
    const share = sum > 0
      ? Math.round((total * weights[i]!) / sum)
      : Math.round(total / lines.length)
    out.push({ item: lines[i]!.item, amount: share })
    placed += share
  }
  // The last line takes the remainder, so the parts always sum to the whole.
  out.push({ item: lines[lines.length - 1]!.item, amount: total - placed })
  return out
}

/**
 * Whether an allocation still adds up.
 *
 * Cheap, and worth asserting before anything is written: the one promise
 * this file makes is that the parts equal the whole, and a promise about
 * money is worth checking rather than trusting.
 */
export function allocationBalances<T>(total: number, allocated: ReadonlyArray<Allocated<T>>): boolean {
  return allocated.reduce((sum, line) => sum + line.amount, 0) === total
}
