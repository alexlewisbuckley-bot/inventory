import type { CurrencyCode } from './enums'
import { searchableText, type XeroInvoice } from './xero-invoice'

/**
 * Pairing Xero's invoices with our sales.
 *
 * Alex's order, and it is an order of confidence rather than of convenience:
 *
 *   1. the invoice number, exactly
 *   2. a stock number found in the reference or a line description
 *   3. the customer, fuzzily, with the amount within 1% and the date within
 *      three days
 *   4. nothing — which goes to the user, not to a guess
 *
 * Each tier runs over every invoice before the next one starts, rather than
 * each invoice running down all four tiers on its own. The difference shows
 * when two invoices want the same sale: taken invoice by invoice, whichever
 * happened to be earlier in the file takes it on a weak tier and the invoice
 * that could have matched it exactly is left with nothing. Taken tier by
 * tier, the exact match always wins, and the file's order stops mattering.
 *
 * A sale is claimed once. An invoice may claim several — Alex: "An invoice
 * can link to multiple sales" — and the tiers are additive for that reason:
 * tier 2 keeps adding watches to an invoice tier 1 has already found one
 * for. A two-watch invoice where one watch already carries the invoice
 * number and the other is only named in the reference would otherwise be
 * settled by the first and the second never looked for, which is the exact
 * failure Alex described as "the system shows it as two unrelated lines".
 *
 * Only tier 3 is exclusive. It picks a single best sale on a balance of
 * three weak signals, so it runs only where nothing firmer found anything.
 *
 * Nothing here writes anything or decides anything final. It proposes, and
 * the review screen disposes.
 */

export type MatchTier = 'invoice' | 'stock' | 'fuzzy' | 'probable' | 'manual'

/**
 * What kind of thing in our book an invoice might be for.
 *
 * Alex: "there are quite a few sales that are not linking, and I think
 * it's due to commissions not being tracked and buybacks."
 *
 * He was right, and it was not a tuning problem: the matcher only ever
 * looked at the sales table, so a Xero invoice for a brokered fee or a
 * buy-back charge had nothing it could possibly match and fell into "in
 * Xero, no sale" every single time. All three earn money, all three get
 * invoiced out of Xero, so all three are candidates.
 */
export type CandidateKind = 'SALE' | 'COMMISSION' | 'BUYBACK'

/** What the matcher needs to know about one row of our book. */
export interface SaleCandidate {
  id: string
  kind: CandidateKind
  /** Only a sale has one, and only a sale can be found by it. */
  stockNo: number | null
  /**
   * The number we have for it: a sale's invoice number, a commission's
   * reference, the reference on the loan a buy-back charge belongs to.
   */
  invoiceNo: string | null
  customerName: string | null
  /** Midnight UTC on its day, as the column stores it. */
  saleDate: Date
  /** What it says it was for, in base minor units. */
  amountBase: number
}

export interface MatchedSale {
  saleId: string
  kind: CandidateKind
  /** How this particular row was found, which may differ within one invoice. */
  tier: MatchTier
}

export interface InvoiceMatch {
  invoiceNo: string
  /** Which invoice in the file this is, since a number can repeat. */
  at: number
  sales: MatchedSale[]
  /**
   * The alias this match would be worth remembering as.
   *
   * Alex: "Suggest a new alias when a fuzzy match is approved; once approved
   * it matches automatically next time." Only a fuzzy hit proposes one — the
   * other tiers did not need the name to agree, so they have learned nothing
   * about it.
   */
  proposedAlias: { systemName: string; xeroName: string } | null
}

export interface MatchResult {
  matched: InvoiceMatch[]
  /** Invoices nothing could be found for. The user links or dismisses these. */
  unmatchedInvoices: XeroInvoice[]
  /** Rows of our book no invoice in this file accounts for. */
  unmatchedSaleIds: string[]
}

/**
 * An invoice number that is not yet an invoice number.
 *
 * "TBA" sits on a sale for days before Xero catches up — it is the thing
 * this whole feature exists to clear — and several sales carry it at once.
 * Matching on it would pair a Xero invoice with whichever TBA sale came
 * first, which is worse than not matching at all.
 */
export function isPlaceholderInvoiceNo(value: string | null): boolean {
  if (!value) return true
  const text = value.trim().toUpperCase()
  if (!text || text === '-' || text === 'N/A') return true
  return /^TB[AD]\b/.test(text) || /^TB[AD][-_ ]?\d*$/.test(text)
}

/** Invoice numbers compare without their spacing or case. */
export const normaliseInvoiceNo = (value: string) =>
  value.trim().toUpperCase().replace(/[\s_]+/g, '')

/**
 * A name compares without case, punctuation or spacing.
 *
 * "&" becomes "and" before the punctuation goes, because the two are the
 * same word and stripping the ampersand instead leaves "A. Dealer & Co" and
 * "A Dealer and Co" three characters apart — far enough to read as two
 * different dealers.
 */
export const normaliseName = (value: string) =>
  value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')

/**
 * How alike two customer names are, from 0 to 1.
 *
 * Built for the way these names actually differ: a trailing "Dubai" or
 * "FZCO", a lost space, "&" against "and". So an exact normalised match
 * scores 1, one name containing the other scores high, and everything else
 * falls back to how much of the longer string survives an edit distance.
 *
 * It cannot and should not reach "Henry Fisher" → "Sweepings Hands". Those
 * two names share nothing, and no amount of fuzziness should pretend
 * otherwise — that pair is what the alias table is for.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = normaliseName(a)
  const right = normaliseName(b)
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) {
    // Scaled by how much of the longer name the shorter one accounts for, so
    // "Trend Sourcing" inside "Trendsourcing Dubai" scores well and a
    // two-letter name inside a long one does not.
    return 0.6 + 0.4 * (Math.min(left.length, right.length) / Math.max(left.length, right.length))
  }
  const distance = editDistance(left, right)
  return Math.max(0, 1 - distance / Math.max(left.length, right.length))
}

/** Levenshtein, two rows at a time. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]!
}

/** Above this two names are the same customer spelled differently. */
export const NAME_THRESHOLD = 0.82

/**
 * Whether a stock number appears in an invoice's text.
 *
 * Bounded on both sides, because "1366" occurs inside "13660" and inside a
 * reference number, a serial and a year. The boundary is any non-digit, so
 * "Stock 1366", "#1366", "1366/1372" and "ref:1366." all hit and "113669"
 * does not.
 */
export function mentionsStockNo(text: string, stockNo: number): boolean {
  return new RegExp(`(?<![0-9])${stockNo}(?![0-9])`).test(text)
}

export interface MatchOptions {
  /** Converts an invoice's own currency into base minor units. */
  toBase: (amountMinor: number, currency: CurrencyCode) => number
  /** Approved system-name → Xero-contact-name pairs. */
  aliases?: Array<{ systemName: string; xeroName: string }>
}

/** 1% either way, which is Alex's tolerance for a converted amount. */
const AMOUNT_TOLERANCE = 0.01
/** Three days either way, which is his tolerance for a date. */
const DAY_TOLERANCE = 3
const DAY = 86_400_000

/**
 * The looser bar, for things worth offering rather than asserting.
 *
 * Alex: "Daniel Buckley, for example, has a buyback for that exact amount
 * or close to that should have been flagged and given the name is the
 * same... Same detail for things like commission that are both 1500
 * dollars that are in the same week. That is likely going to be the same
 * thing. It could flag as amber."
 *
 * So: the same week rather than three days, a little more drift on the
 * amount, and a name that still has to look like the same customer. What
 * comes out is explicitly a suggestion — it is shown in amber, it is not
 * ticked, and it is never applied unless somebody ticks it. The point is
 * that a probable match is far more use on the screen than in the
 * "nothing matched" pile, which is where all of these were going.
 */
const PROBABLE_AMOUNT_TOLERANCE = 0.02
const PROBABLE_DAY_TOLERANCE = 7

export function matchInvoices(
  invoices: XeroInvoice[],
  sales: SaleCandidate[],
  { toBase, aliases = [] }: MatchOptions,
): MatchResult {
  const claimed = new Set<string>()
  /*
   * Built up across the tiers, keyed by the invoice's place in the file
   * rather than by its number.
   *
   * A number is not unique in practice — a file can carry the same invoice
   * twice, and a credit note often repeats the number it credits — and
   * keying on it collapsed two rows into one, which handed the same sale
   * back under both of them.
   */
  const found = new Map<number, MatchedSale[]>()
  const byId = new Map(sales.map((sale) => [sale.id, sale]))
  const add = (at: number, saleId: string, tier: MatchTier) => {
    claimed.add(saleId)
    found.set(at, [...(found.get(at) ?? []), {
      saleId, kind: byId.get(saleId)?.kind ?? 'SALE', tier,
    }])
  }
  const aliasProposals = new Map<number, InvoiceMatch['proposedAlias']>()

  const aliasFor = new Map(
    aliases.map((pair) => [normaliseName(pair.xeroName), normaliseName(pair.systemName)]),
  )

  // --- 1. the invoice number, exactly -------------------------------------
  const byInvoiceNo = new Map<string, SaleCandidate[]>()
  for (const sale of sales) {
    if (isPlaceholderInvoiceNo(sale.invoiceNo)) continue
    const key = normaliseInvoiceNo(sale.invoiceNo!)
    byInvoiceNo.set(key, [...(byInvoiceNo.get(key) ?? []), sale])
  }
  invoices.forEach((invoice, at) => {
    const hits = byInvoiceNo.get(normaliseInvoiceNo(invoice.invoiceNo)) ?? []
    for (const sale of hits) {
      if (claimed.has(sale.id)) continue
      add(at, sale.id, 'invoice')
    }
  })

  // --- 2. a stock number in the reference or a line ------------------------
  // Additive: an invoice that already found one watch can still be
  // carrying another that is only named in its reference. Only a row with
  // a stock number can be found this way, which in practice means a sale
  // and a commission brokered on one of our own watches.
  invoices.forEach((invoice, at) => {
    const text = searchableText(invoice)
    if (!text) return
    for (const sale of sales) {
      if (claimed.has(sale.id) || sale.stockNo === null) continue
      if (!mentionsStockNo(text, sale.stockNo)) continue
      add(at, sale.id, 'stock')
    }
  })

  /*
   * --- 3 and 4. the customer, the amount and the date, all three ---------
   *
   * The same three signals twice, at two bars. The tight one is a match;
   * the loose one is a suggestion the screen shows in amber and does not
   * tick. Running them as separate passes matters: every invoice gets its
   * chance at a confident hit before any invoice is allowed a probable
   * one, so a likely guess never takes a row that a firmer reading of
   * another invoice would have claimed.
   */
  const bestFor = (invoice: XeroInvoice, amountTolerance: number, dayTolerance: number) => {
    if (!invoice.contactName || !invoice.invoiceDate) return null
    const wanted = toBase(invoice.total, invoice.currency)
    if (wanted <= 0) return null

    let best: { sale: SaleCandidate; score: number } | null = null
    for (const sale of sales) {
      if (claimed.has(sale.id) || !sale.customerName) continue

      // The amount, converted first. Alex: "Never compare amounts across
      // currencies without converting first."
      const drift = Math.abs(sale.amountBase - wanted) / wanted
      if (drift > amountTolerance) continue

      const days = Math.abs(sale.saleDate.getTime() - invoice.invoiceDate.getTime()) / DAY
      if (days > dayTolerance) continue

      // An approved alias is an exact answer, not a fuzzy one.
      const alias = aliasFor.get(normaliseName(invoice.contactName))
      const score = alias && alias === normaliseName(sale.customerName)
        ? 1
        : nameSimilarity(sale.customerName, invoice.contactName)
      if (score < NAME_THRESHOLD) continue
      // Ties broken towards the closer amount, so two commissions a week
      // apart at the same price go to the one priced identically.
      const weighted = score - drift
      if (!best || weighted > best.score) best = { sale, score: weighted }
    }
    return best
  }

  const takeBest = (at: number, invoice: XeroInvoice, tier: MatchTier, best: ReturnType<typeof bestFor>) => {
    if (!best) return
    add(at, best.sale.id, tier)
    // Worth remembering only where the two names are not already the same.
    aliasProposals.set(
      at,
      normaliseName(best.sale.customerName!) === normaliseName(invoice.contactName)
        ? null
        : { systemName: best.sale.customerName!, xeroName: invoice.contactName },
    )
  }

  for (const [at, invoice] of invoices.entries()) {
    if (found.has(at)) continue
    takeBest(at, invoice, 'fuzzy', bestFor(invoice, AMOUNT_TOLERANCE, DAY_TOLERANCE))
  }

  for (const [at, invoice] of invoices.entries()) {
    if (found.has(at)) continue
    takeBest(at, invoice, 'probable',
      bestFor(invoice, PROBABLE_AMOUNT_TOLERANCE, PROBABLE_DAY_TOLERANCE))
  }

  const matched: InvoiceMatch[] = invoices
    .map((invoice, at) => ({ invoice, at }))
    .filter(({ at }) => found.has(at))
    .map(({ invoice, at }) => ({
      invoiceNo: invoice.invoiceNo,
      /** Its place in the file, so a repeated number still reads as two. */
      at,
      sales: found.get(at)!,
      proposedAlias: aliasProposals.get(at) ?? null,
    }))

  return {
    matched,
    unmatchedInvoices: invoices.filter((_, at) => !found.has(at)),
    unmatchedSaleIds: sales.filter((sale) => !claimed.has(sale.id)).map((sale) => sale.id),
  }
}

/**
 * An invoice nobody sold anything for, which is probably a Buy Back.
 *
 * Alex: "Invoices that don't match any sale and are tagged or named as Buy
 * Back (or marked so by the user) go into a Buy Back pending bucket." Read
 * from the words on the invoice, and only ever a suggestion — the user still
 * says which bucket it belongs in.
 */
export function looksLikeBuyBack(invoice: XeroInvoice): boolean {
  const text = `${invoice.reference} ${invoice.lines.map((l) => l.description).join(' ')}`
  return /\bbuy[\s-]?backs?\b/i.test(text)
}
