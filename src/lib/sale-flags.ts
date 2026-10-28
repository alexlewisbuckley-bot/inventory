import { isPlaceholderInvoiceNo } from './xero-match'

/**
 * What is wrong with a row on the sales ledger.
 *
 * Alex: "Data-quality flags on the main sales table, always on, not just
 * at import."
 *
 * Always on is the whole point. A check that only runs when somebody
 * happens to drop a Xero export is a check that tells you about a problem
 * after it has been a problem for a week — and the first of these, an
 * invoice number still reading "TBA", is precisely a problem measured in
 * days.
 *
 * Pure, and computed from the row rather than stored, so a flag cannot go
 * stale. Filling in a customer clears the flag because the flag was never
 * written down.
 */

export type SaleFlagKind =
  | 'INVOICE_TBA'
  | 'NO_CUSTOMER'
  | 'NO_STOCK_NO'
  | 'ZERO_COST'
  | 'PAST_DUE'
  | 'NOT_IN_XERO'

export interface SaleFlag {
  kind: SaleFlagKind
  /** What to say about it, in words somebody can act on. */
  detail: string
}

export const FLAG_LABELS: Record<SaleFlagKind, string> = {
  INVOICE_TBA: 'No invoice number',
  NO_CUSTOMER: 'No customer',
  NO_STOCK_NO: 'No stock number',
  ZERO_COST: 'Likely a commission',
  PAST_DUE: 'Past due',
  NOT_IN_XERO: 'Not in Xero',
}

/** The row a flag is read off. Only what the checks actually need. */
export interface FlaggableSale {
  invoiceNo: string | null
  saleDate: Date
  customerName: string | null
  stockNo: number | null
  /**
   * What the watch cost, or null where this reader may not see it.
   *
   * The column is NOT NULL in the database, so a null here can only mean
   * redacted — and showing somebody an error about a figure they cannot
   * see, and nobody else can reproduce, is worse than showing nothing.
   */
  costGbp: number | null
  channel: string
  paymentStatus: string
  dueOn: Date | null
  /** Which import last accounted for it, if any. */
  xeroSeenImportId: string | null
  /** A commission or a buy-back charge, which has no stock under it. */
  stockless?: boolean
}

/** The last import, and the period it was meant to account for. */
export interface LastImport {
  id: string
  coversFrom: Date | null
  coversTo: Date | null
}

const DAY = 86_400_000
/** Alex's tolerance: a day or two for Xero to catch up is normal. */
const TBA_GRACE_DAYS = 2

export function flagsFor(
  sale: FlaggableSale,
  { now = new Date(), lastImport = null }: { now?: Date; lastImport?: LastImport | null } = {},
): SaleFlag[] {
  const flags: SaleFlag[] = []

  // An invoice number that is still a placeholder, once Xero has had time.
  // "TBA" on this morning's sale is how the business works; "TBA" on last
  // week's is the thing being chased.
  if (isPlaceholderInvoiceNo(sale.invoiceNo)) {
    const days = Math.floor((now.getTime() - sale.saleDate.getTime()) / DAY)
    if (days > TBA_GRACE_DAYS) {
      flags.push({
        kind: 'INVOICE_TBA',
        detail: `${days} days since the sale and still ${sale.invoiceNo?.trim() || 'blank'}`,
      })
    }
  }

  if (!sale.customerName?.trim()) {
    flags.push({ kind: 'NO_CUSTOMER', detail: 'Nobody is named on this sale' })
  }

  // Only where there should be one. A commission is a fee on somebody
  // else's watch and a buy-back charge is interest, so neither has a stock
  // number to be missing.
  if (!sale.stockless && sale.stockNo === null) {
    flags.push({ kind: 'NO_STOCK_NO', detail: 'No watch is attached' })
  }

  /*
   * Cost zero where there should be a cost.
   *
   * Alex: "Commission lines have no cost by definition... Flag any
   * non-commission sale with cost $0 as an error." A zero cost on a watch
   * we bought is not a bargain, it is a blank — and it reports as 100%
   * margin, which flatters every total it is counted in.
   *
   * And later, on two of them: "If there is no cost it's likely a
   * commision invoice not a sale to purchase." Which is the usual cause,
   * so the flag says so rather than only stating the symptom. The remedy
   * is already one click away in the row's own menu — "Record as a
   * commission…" — and naming the likely diagnosis is what connects the
   * two. Hedged, because the other cause is a cost somebody has not
   * typed in yet, and that is a different fix.
   */
  if (!sale.stockless
    && (sale.channel === 'TRADE' || sale.channel === 'RETAIL')
    && sale.costGbp === 0) {
    flags.push({
      kind: 'ZERO_COST',
      detail: 'A sale with no cost is usually a commission booked as a sale — '
        + 'use "Record as a commission" on this row. Until it is one or the other, '
        + 'it reports as pure profit at 100% margin.',
    })
  }

  // Unpaid and past the date it was due, which is a different question
  // from unpaid: an invoice on 30-day terms raised yesterday is both
  // unpaid and perfectly healthy.
  const unpaid = sale.paymentStatus !== 'PAID' && sale.paymentStatus !== 'REFUNDED'
  if (unpaid && sale.dueOn && sale.dueOn.getTime() < now.getTime()) {
    const days = Math.floor((now.getTime() - sale.dueOn.getTime()) / DAY)
    flags.push({ kind: 'PAST_DUE', detail: `${days} ${days === 1 ? 'day' : 'days'} past the due date` })
  } else if (unpaid && !sale.dueOn && sale.paymentStatus === 'OVERDUE') {
    // Xero's own verdict, where we have no due date of our own to check.
    flags.push({ kind: 'PAST_DUE', detail: 'Xero marked this overdue' })
  }

  /*
   * In the book, not in the accounts.
   *
   * Only asked of sales inside the period the last import covered. A
   * month of Xero invoices says nothing whatever about a sale from two
   * years ago, and flagging the whole back catalogue the first time
   * somebody drops a file is how a flag gets ignored.
   */
  if (lastImport?.coversFrom && lastImport.coversTo
    && sale.saleDate >= lastImport.coversFrom
    && sale.saleDate <= lastImport.coversTo
    && sale.xeroSeenImportId !== lastImport.id) {
    flags.push({ kind: 'NOT_IN_XERO', detail: 'The last Xero import did not account for this' })
  }

  return flags
}

/**
 * How loud a row should be.
 *
 * A missing cost misstates the profit on every report it reaches, and a
 * sale the accounts have never heard of is the reason this feature exists.
 * A blank customer is untidy. They should not look the same.
 */
export function flagTone(kind: SaleFlagKind): 'serious' | 'warning' {
  return kind === 'ZERO_COST' || kind === 'NOT_IN_XERO' || kind === 'PAST_DUE'
    ? 'serious'
    : 'warning'
}
