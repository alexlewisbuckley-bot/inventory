import {
  BASE_CURRENCY, CURRENCIES, DEFAULT_PRODUCT_TYPE, PRODUCT_TYPES, VAT_SCHEMES,
  type CurrencyCode, type ProductType, type VatScheme,
} from './enums'

/**
 * Reading a supplier invoice.
 *
 * Two readers produce the same shape. The rule-based one below works on the
 * text layer of the PDF and never leaves the process; Claude reads the
 * document itself and copes with layouts nobody anticipated, including scans
 * with no text layer at all. Neither is trusted alone: `mergeExtractions`
 * prefers Claude's reading and falls back to the rules field by field, so a
 * missing API key degrades the result rather than removing the feature.
 *
 * Everything here is pure and string-in, object-out — which is what makes the
 * interesting cases (a margin-scheme invoice, a serial that looks like a
 * reference, a total that disagrees with its lines) testable without a
 * database, a network or a PDF.
 */

/** One watch on an invoice. Amounts are major units in the invoice's currency. */
export interface ExtractedLine {
  /** The line exactly as it appeared, kept so a human can always check the read. */
  description: string
  brand: string | null
  /** The manufacturer's reference — `model` in the stock record. */
  reference: string | null
  serial: string | null
  year: number | null
  productType: ProductType
  unitAmount: number | null
  vatAmount: number | null
  quantity: number
}

export interface ExtractedSupplier {
  name: string | null
  legalName: string | null
  vatNo: string | null
  registrationNo: string | null
  email: string | null
  phone: string | null
  /** The trading address, kept as the invoice lays it out. */
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  postcode: string | null
  country: string | null
}

export interface ExtractedInvoice {
  supplier: ExtractedSupplier
  invoiceNo: string | null
  /** ISO date string, or null when the document does not state one. */
  invoiceDate: string | null
  currency: CurrencyCode
  netAmount: number | null
  vatAmount: number | null
  grossAmount: number | null
  vatScheme: VatScheme
  lines: ExtractedLine[]
}

export const EMPTY_EXTRACTION: ExtractedInvoice = {
  supplier: {
    name: null, legalName: null, vatNo: null, registrationNo: null, email: null, phone: null,
    addressLine1: null, addressLine2: null, city: null, postcode: null, country: null,
  },
  invoiceNo: null,
  invoiceDate: null,
  currency: BASE_CURRENCY,
  netAmount: null,
  vatAmount: null,
  grossAmount: null,
  vatScheme: 'UNKNOWN',
  lines: [],
}

/**
 * Brands the trade deals in, for recognising one in a line of prose.
 *
 * Seeded rather than exhaustive: the brands already in the database are passed
 * in alongside these, so the list a business actually buys grows by buying
 * rather than by editing this file.
 */
const KNOWN_BRANDS = [
  'Rolex', 'Patek Philippe', 'Audemars Piguet', 'Omega', 'Cartier', 'Breitling',
  'IWC', 'Jaeger-LeCoultre', 'Panerai', 'Hublot', 'Tudor', 'Vacheron Constantin',
  'A. Lange & Söhne', 'Richard Mille', 'Grand Seiko', 'Zenith', 'Chopard',
  'Longines', 'TAG Heuer', 'Breguet', 'Blancpain', 'Bvlgari', 'Montblanc',
  'Hermès', 'Chanel', 'Tiffany & Co.', 'Girard-Perregaux', 'Ulysse Nardin',
]

const CURRENCY_HINTS: Array<[RegExp, CurrencyCode]> = [
  [/\bGBP\b|£/, 'GBP'],
  [/\bUSD\b|\bUS\$/, 'USD'],
  [/\bAED\b|\bDHS?\b/, 'AED'],
  [/\bHKD\b|\bHK\$/, 'HKD'],
]

/**
 * The VAT treatment, from the words the invoice uses for it.
 *
 * Ordered deliberately: an invoice that mentions both the margin scheme and a
 * 20% line is a margin invoice quoting the rate, not a standard-rated one.
 */
export function detectVatScheme(text: string): VatScheme {
  const t = text.toLowerCase()
  if (/margin scheme|second[- ]?hand margin|global accounting|vat margin|margin\s*\/\s*second hand/.test(t)) return 'MARGIN'
  if (/reverse charge/.test(t)) return 'REVERSE_CHARGE'
  if (/zero[- ]?rated|zero rate|export sale|0%\s*vat|vat\s*@?\s*0(\.0+)?\s*%/.test(t)) return 'ZERO_RATED'
  if (/vat\s*@?\s*20(\.0+)?\s*%|standard[- ]?rated|20% vat/.test(t)) return 'STANDARD'
  return 'UNKNOWN'
}

/**
 * Undo text that a PDF drew twice.
 *
 * Several invoice generators fake bold by stroking the same string twice with
 * a hair's offset. The text layer then interleaves the two copies run by run,
 * so "INVOICE" arrives as "INVINVOICEOICE" and "BILL TO" as "BILL TBILL TOO".
 *
 * It is recoverable exactly, because the damage has a shape: the string is a
 * sequence of chunks each immediately repeated — a1 a1 a2 a2 … — so taking the
 * shortest repeated chunk at each step and keeping one copy rebuilds the
 * original. Anything that does not decompose that way is left alone.
 *
 * This is worth doing properly rather than patching around: the run that
 * corrupted "BILL TO" stopped the buyer's block being recognised, and the
 * invoice was booked in against the customer instead of the supplier.
 */
export function undoubleText(text: string): string {
  return text.split('\n').map(undoubleLine).join('\n')
}

function undoubleLine(line: string): string {
  // Long lines are prose or a table row, not a drawn-twice heading, and the
  // scan is quadratic in the line length.
  if (line.length < 6 || line.length > 300) return line

  const chunks: string[] = []
  let i = 0
  let skipped = 0
  while (i < line.length) {
    let matched = 0
    for (let k = 1; i + 2 * k <= line.length; k += 1) {
      if (line.slice(i, i + k) === line.slice(i + k, i + 2 * k)) { matched = k; break }
    }
    if (matched === 0) {
      // The second copy of a run can lose its leading space, so a lone space
      // sits unpaired between two paired runs: "GBP £9,800.00" comes out as
      // "GBPGBP £9,£9,800.800.0000". Stepping over it keeps the decomposition
      // going; without this the line survived doubled and was read as a
      // second watch costing £9.
      if (chunks.length > 0 && line[i] === ' ' && skipped < 3) {
        chunks.push(' ')
        skipped += 1
        i += 1
        continue
      }
      break
    }
    chunks.push(line.slice(i, i + matched))
    i += 2 * matched
  }

  // Only the label is drawn twice, so the doubling is a prefix and the rest of
  // the row is ordinary text: "TTOOTTALAL £9,800.00" is TOTAL followed by a
  // perfectly normal amount. Consuming only the prefix is what stops that row
  // being read as another watch.
  const consumed = i
  if (chunks.length < 2 || consumed < 6) return line
  return chunks.join('') + line.slice(consumed)
}

/** A money figure as written on an invoice: £12,500.00, 12500, 9 500.50. */
export function parseAmount(raw: string | null | undefined): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[£$€]|GBP|USD|AED|HKD|HK\$|US\$/gi, '').replace(/[,\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/** DD/MM/YYYY, YYYY-MM-DD, and "8 April 2026" — the three an invoice actually uses. */
export function parseInvoiceDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = raw.trim()

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`).toISOString()

  const dmy = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(text)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3])
    // Day-first, because these are British invoices. A day over 12 is the only
    // way to be sure, and guessing the other way round moves a purchase by
    // months in the ageing report.
    if (day <= 31 && month <= 12) return new Date(Date.UTC(year, month - 1, day)).toISOString()
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const named = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/.exec(text)
  if (named) {
    const month = MONTHS.indexOf(named[2]!.slice(0, 3).toLowerCase())
    if (month >= 0) return new Date(Date.UTC(Number(named[3]), month, Number(named[1]))).toISOString()
  }
  return null
}

/**
 * A manufacturer's reference: 126711CHNR, 5711/1A, 116610LV, IW371446.
 *
 * The letter prefix must be attached to the digits. Allowing a space made
 * "GMT-Master II 126711CHNR" read as reference "II 126711CHNR" — a reference
 * that matches no watch ever made, and one that would then fail to match the
 * same watch arriving on a second invoice.
 */
const REFERENCE = /\b(?:[A-Z]{2,4})?\d{3,6}[A-Z]{0,6}(?:\/\d{1,3}[A-Z]{0,3})?\b/

const NOISE_LINE = /^(invoice|bill to|ship to|subtotal|sub total|total|vat|net|amount due|balance|payment|terms|thank you|page \d)/i

/** A line that is a form label rather than anybody's name. */
const LABELLED_LINE = /^(invoice|tax invoice|date|dated|due|terms|bill|ship|sold|customer|description|qty|quantity|rate|amount|page|ref)\b/i

const LEGAL_ENTITY = /\b(limited|ltd\.?|llp|plc|gmbh|s\.?a\.?r\.?l\.?|inc\.?|b\.?v\.?|n\.?v\.?|pty|s\.?p\.?a\.?)\b/i

/** The row that introduces the items table: "Description  Quantity  Rate  Amount". */
const ITEMS_HEADER = /^description\b.*\b(amount|rate|price|total|value|cost)\b/i

/** Where the items stop and the arithmetic starts. */
const TOTALS_LINE = /^(sub\s*total|total|paid|balance|amount\s+due|vat\b|net\b|discount)/i
const PAYMENT_SECTION = /^(payment|bank\s+details|remittance|terms|thank you|notes?|international)\b/i

/** Money as invoices write it: £18,600.00, $1,250, 8950.00. */
const MONEY_G = /[£$]\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b|\b\d{3,}\.\d{2}\b/g

const LABELLED_REFERENCE = /\b(?:model|ref|reference)\s*(?:no\.?|number|#)?\s*[:\-]\s*([A-Z0-9][A-Z0-9\-/.]{2,17})/i
const LABELLED_SERIAL = /\b(?:serial|s\/n|case)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9]{4,14})\b/i

/**
 * Read what can be read from the invoice's text layer.
 *
 * Conservative on purpose. A watch becomes stock only when the document gives
 * it both an identity and a price — the two things it cannot be booked in
 * without. Everything else is left for Claude or reported as an issue, because
 * a confidently wrong row in the stock list costs more than a row that says it
 * needs attention.
 */
export function parseInvoiceText(text: string, extraBrands: string[] = []): ExtractedInvoice {
  const brands = [...new Set([...KNOWN_BRANDS, ...extraBrands])]
    .filter((b) => b.trim().length > 1)
    .sort((a, b) => b.length - a.length)

  const lines = undoubleText(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const whole = lines.join('\n')
  const buyer = buyerBlock(lines)
  // Every fact about the seller is looked for outside the buyer's block, so a
  // "Bill To" address can never supply the supplier's name or email.
  const sellerText = lines.filter((_, index) => !buyer.has(index)).join('\n')

  const currency = CURRENCY_HINTS.find(([pattern]) => pattern.test(whole))?.[1] ?? BASE_CURRENCY

  const invoiceNo = firstMatch(whole, [
    /invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i,
    /\binv\s*[:\-#]\s*([A-Z0-9][A-Z0-9\-/]{2,})/i,
  ]) ?? labelledBelow(lines, /^invoice(\s*(?:no\.?|number|#))?\s*:?$/i, /^[A-Z0-9][A-Z0-9\-/]{2,}$/i)

  const invoiceDate = parseInvoiceDate(
    firstMatch(whole, [
      /(?:invoice\s*date|date\s*of\s*invoice|dated)\s*[:\-]?\s*([^\n]{6,30})/i,
      /\bdate\s*[:\-]\s*([^\n]{6,30})/i,
    ]) ?? labelledBelow(lines, /^(invoice\s*)?date\s*:?$/i, /\d/) ?? '',
  )

  // Every total must carry a currency symbol or pence. "Terms: NET 0" read as
  // a net total of zero, and "VAT Reg No: GB 384 2910 55" as £3.8m of tax.
  const netAmount = parseAmount(firstMatch(whole, [
    /(?:sub\s*total|net\s*(?:total|amount)|goods\s*total)\s*[:\-]?\s*([£$]\s?[\d,]+(?:\.\d{2})?|[\d,]+\.\d{2})/i,
  ]))
  const vatAmount = parseAmount(firstMatch(whole, [
    /\bvat\b(?!\s*(?:reg|registration|no\b|number|id\b))[^\n\d]{0,15}?([£$]\s?[\d,]+(?:\.\d{2})?)/i,
    /\bvat\b(?!\s*(?:reg|registration|no\b|number|id\b))[^\n\d]{0,15}?\b([\d,]+\.\d{2})\b/i,
  ]))
  const grossAmount = parseAmount(firstMatch(whole, [
    /(?:^|\n)\s*(?:grand\s*total|total\s*(?:due|payable|amount)?|amount\s*due|balance\s*due)\s*[:\-]?\s*([£$]\s?[\d,]+(?:\.\d{2})?|[\d,]+\.\d{2})/i,
  ]))

  return {
    supplier: parseSupplier(lines, sellerText, buyer),
    invoiceNo,
    invoiceDate,
    currency,
    netAmount,
    vatAmount,
    grossAmount,
    vatScheme: detectVatScheme(whole),
    lines: parseItems(lines, brands, buyer),
  }
}

/**
 * The lines describing the customer, so nothing reads them as the seller.
 *
 * Bounded rather than run to the next blank line, because the text layer of a
 * PDF has no reliable blank lines — it has whatever order the renderer emitted
 * the strings in.
 */
function buyerBlock(lines: string[]): Set<number> {
  const start = lines.findIndex((line) => /^(bill\s*to|invoice\s*to|sold\s*to|ship\s*to|customer)\b/i.test(line))
  if (start < 0) return new Set()

  const block = new Set<number>([start])
  for (let i = start + 1; i < Math.min(lines.length, start + 6); i += 1) {
    const line = lines[i]!
    if (ITEMS_HEADER.test(line) || TOTALS_LINE.test(line) || new RegExp(MONEY_G.source).test(line)) break
    block.add(i)
  }
  return block
}

/**
 * The watches, however the invoice lays them out.
 *
 * The shape that matters is the multi-line one: a real invoice writes "Rolex
 * Skydweller", then "Model no - 336934", then "Serial no - 30ER3414", then a
 * quantity/rate/amount row — four lines for one watch. Reading line by line
 * finds nothing at all on an invoice like that, because no single line carries
 * both a maker and a price.
 *
 * So lines are gathered into a block and the block is closed by the row that
 * carries the money. Where a document has no items table to anchor on, the
 * old line-at-a-time reading still applies.
 */
function parseItems(lines: string[], brands: string[], buyer: Set<number>): ExtractedLine[] {
  const headerAt = lines.findIndex((line) => ITEMS_HEADER.test(line))
  if (headerAt < 0) {
    return lines.flatMap((line, index) => (buyer.has(index) ? [] : parseLine(line, brands) ?? []))
  }

  const items: ExtractedLine[] = []
  let block: string[] = []

  for (let i = headerAt + 1; i < lines.length; i += 1) {
    const line = lines[i]!
    if (TOTALS_LINE.test(line) || PAYMENT_SECTION.test(line)) break
    if (buyer.has(i)) continue

    block.push(line)
    if (hasMoney(line)) {
      const item = parseBlock(block, brands)
      if (item) items.push(item)
      block = []
    }
  }
  return items
}

const hasMoney = (line: string): boolean => new RegExp(MONEY_G.source).test(line)

const moneyIn = (line: string): number[] =>
  [...line.matchAll(MONEY_G)]
    .map((match) => parseAmount(match[0]))
    .filter((value): value is number => value !== null)

/** One item block — its description lines plus the row carrying the money. */
function parseBlock(block: string[], brands: string[]): ExtractedLine | null {
  const moneyLine = block[block.length - 1]!
  const descriptionLines = block.slice(0, -1)
  const text = block.join('\n')

  const amounts = moneyIn(moneyLine)
  if (amounts.length === 0) return null

  // "1  £18,600.00  £18,600.00" is quantity, rate, then line total. The rate is
  // what one watch cost, and one watch is what gets created.
  const quantityMatch = /^\s*(\d{1,3})(?:\s|x|×)/i.exec(moneyLine)
  const quantity = quantityMatch ? Math.min(Math.max(Number(quantityMatch[1]), 1), 50) : 1
  const unitAmount = amounts.length >= 2 ? amounts[0]! : amounts[amounts.length - 1]!

  // On a one-line item the description IS the money row, so the year, the
  // reference and the description all read from the same text.
  const descriptionText = (descriptionLines.length > 0 ? descriptionLines.join(' ') : moneyLine).trim()

  const brand = brands.find((candidate) => text.toLowerCase().includes(candidate.toLowerCase())) ?? null
  let serial = firstMatch(text, [LABELLED_SERIAL])

  // Nothing labelled, two bracketed codes: "Rolex GMT (126710BLNR) (5D2883J4)"
  // is reference then serial, in that order, which is how the trade writes it.
  const bracketed = [...text.matchAll(/\(([A-Z0-9][A-Z0-9\-/.]{3,15})\)/gi)].map((match) => match[1]!)
  if (!serial && bracketed.length >= 2) serial = bracketed[1]!
  const year = yearIn(descriptionText)

  let reference = firstMatch(text, [LABELLED_REFERENCE]) ?? (bracketed.length >= 2 ? bracketed[0]! : null)
  if (!reference) {
    // Nothing labelled it, so look for something reference-shaped in the
    // description with the brand, the serial, the year and the money removed.
    let remainder = descriptionText
    if (brand) remainder = remainder.replace(new RegExp(escapeRegExp(brand), 'ig'), ' ')
    if (serial) remainder = remainder.replace(serial, ' ')
    if (year) remainder = remainder.replace(String(year), ' ')
    remainder = remainder.replace(MONEY_G, ' ')
    reference = REFERENCE.exec(remainder)?.[0]?.trim() ?? null
  }

  if (!descriptionText) return null
  if (!brand && !reference) return null

  return {
    description: descriptionText,
    brand,
    reference,
    serial,
    year,
    productType: DEFAULT_PRODUCT_TYPE,
    unitAmount,
    vatAmount: null,
    quantity,
  }
}

/** One self-contained line, for invoices with no items table to anchor on. */
function parseLine(line: string, brands: string[]): ExtractedLine | null {
  if (NOISE_LINE.test(line)) return null
  const item = parseBlock([line], brands)
  return item && item.unitAmount ? item : null
}

/**
 * Who sent it.
 *
 * Not "the top of the document". Plenty of invoices — including every one
 * generated by the common bookkeeping tools — put the customer at the top and
 * the seller in the footer beside the bank details. What identifies the seller
 * is that it is a company somewhere outside the "Bill To" block, so that is
 * what is looked for, and the letterhead is only the fallback.
 */
function parseSupplier(lines: string[], sellerText: string, buyer: Set<number>): ExtractedSupplier {
  const outside = lines.filter((_, index) => !buyer.has(index))
  const address = parseAddress(outside)

  const named = firstMatch(sellerText, [/(?:from|supplier|vendor|seller)\s*[:\-]\s*([^\n]{2,80})/i])
  const legalName = outside.find((line) => (
    LEGAL_ENTITY.test(line) && !NOISE_LINE.test(line) && !LABELLED_LINE.test(line) && line.length < 80
  )) ?? null
  const letterhead = outside.find((line) => (
    !NOISE_LINE.test(line) && !LABELLED_LINE.test(line) && !hasMoney(line) && line.length > 2 && line.length < 80
  )) ?? null

  return {
    name: (named ?? legalName ?? letterhead)?.trim() ?? null,
    legalName: legalName?.trim() ?? null,
    vatNo: firstMatch(sellerText, [
      /\bvat\s*(?:reg(?:istration)?\.?\s*)?(?:no\.?|number|#)?\s*[:\-]?\s*((?:GB|IE|FR|DE|NL|IT|ES)?\s?\d[\d\s]{6,14})/i,
    ])?.replace(/\s+/g, '') ?? null,
    registrationNo: firstMatch(sellerText, [
      /(?:company|co\.?|reg(?:istration)?)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z]{0,2}\d{6,8})/i,
    ]) ?? null,
    // From the seller's half of the document only: the buyer's address block
    // is usually the first email on the page.
    email: firstMatch(sellerText, [/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/]),
    phone: parsePhone(sellerText),
    addressLine1: address.line1,
    addressLine2: address.line2,
    city: address.city,
    postcode: address.postcode,
    country: firstMatch(sellerText, [/\b(United Kingdom|England|Scotland|Wales|Switzerland|United Arab Emirates|UAE|Hong Kong|Italy|France|Germany|USA|United States)\b/i]),
  }
}

/**
 * A label on one line with its value on the next.
 *
 * A two-column invoice header renders as "INVOICE" then "INV0261" then "DATE"
 * then the date — the colon a single-line pattern looks for never exists.
 */
function labelledBelow(lines: string[], label: RegExp, value: RegExp): string | null {
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!label.test(lines[i]!)) continue
    const next = lines[i + 1]!.trim()
    if (value.test(next)) return next
  }
  return null
}

/** UK postcodes, which are the reliable anchor in an address block. */
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i

/**
 * The seller's address, found by anchoring on the postcode.
 *
 * An address block has no label and no fixed number of lines, but it almost
 * always ends in a postcode — so the postcode is located first and the lines
 * above it are read backwards: the line before it is the town, and what
 * precedes that is the street.
 */
function parseAddress(outside: string[]): {
  line1: string | null; line2: string | null; city: string | null; postcode: string | null
} {
  const empty = { line1: null, line2: null, city: null, postcode: null }

  // The last postcode on the seller's half: a letterhead repeats the address in
  // the footer, and the footer copy is the more complete one.
  let at = -1
  for (let i = outside.length - 1; i >= 0; i -= 1) {
    if (POSTCODE.test(outside[i]!)) { at = i; break }
  }
  if (at < 0) return empty

  const line = outside[at]!
  const postcode = POSTCODE.exec(line)?.[1]?.replace(/\s+/g, ' ').toUpperCase() ?? null

  // "7 Park Row, Leeds, LS1 5DH, UK" is a whole address on one line. Split on
  // the commas and read outwards from the postcode: what precedes it is the
  // town, what precedes that is the street.
  const parts = line.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 3) {
    const postcodeAt = parts.findIndex((part) => POSTCODE.test(part))
    if (postcodeAt > 0) {
      const street = parts.slice(0, Math.max(0, postcodeAt - 1))
      return {
        line1: street[0] ?? null,
        line2: street.slice(1).join(', ') || null,
        city: parts[postcodeAt - 1] ?? null,
        postcode,
      }
    }
  }

  // "Hathersage, S32 1DD" puts the town on the same line as the postcode.
  const sameLineTown = line.replace(POSTCODE, '').replace(/[,\s]+$/, '').trim()

  const above = outside.slice(Math.max(0, at - 3), at)
    .map((value) => value.trim())
    .filter((value) => (
      value.length > 1
      && !/@|\b(company|vat|reg|tel|phone|invoice|sort code|account|iban|swift)\b/i.test(value)
      && !LEGAL_ENTITY.test(value)
    ))

  const city = sameLineTown || above[above.length - 1] || null
  const street = sameLineTown ? above.slice(-2) : above.slice(0, -1).slice(-2)

  return {
    line1: street[0] ?? null,
    line2: street[1] ?? null,
    city,
    postcode,
  }
}

/**
 * A telephone number, labelled or not.
 *
 * A letterhead often prints the number bare. The risk in matching a bare run
 * of digits is everything else on an invoice that is also digits, so anything
 * introduced by the words that precede an account, sort code, company or VAT
 * number is refused outright.
 */
function parsePhone(text: string): string | null {
  const labelled = firstMatch(text, [/(?:tel|phone|mob(?:ile)?|contact)\s*[:\-.]?\s*(\+?[\d\s()-]{9,20})/i])
  if (labelled) return labelled.trim()

  for (const line of text.split('\n')) {
    if (/\b(account|sort\s*code|iban|swift|company|vat|invoice|reg)\b/i.test(line)) continue
    const match = /(?:^|\s)(\+44\s?\d[\d\s-]{8,13}|0\d{2,4}[\s-]?\d{3}[\s-]?\d{3,4})(?=\s|$)/.exec(line)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

function yearIn(text: string): number | null {
  const match = /\b(19[5-9]\d|20[0-4]\d)\b/.exec(text)
  if (!match) return null
  const year = Number(match[1])
  return year <= new Date().getFullYear() + 1 ? year : null
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// Merging the two readings
// ---------------------------------------------------------------------------

const pick = <T>(preferred: T | null | undefined, fallback: T | null | undefined): T | null =>
  preferred !== null && preferred !== undefined && preferred !== '' ? preferred : (fallback ?? null)

/**
 * Claude's reading, backed by the rules.
 *
 * Field by field rather than whole-object: Claude reads layout and prose far
 * better, but the rule-based pass is the one that can be relied on for the
 * things regular expressions are actually good at — a VAT number, a company
 * number, an email address — and it fills any gap Claude left. Lines come from
 * whichever reader found more of them, because a reader that found three
 * watches on a three-watch invoice beats one that found one.
 */
export function mergeExtractions(ai: ExtractedInvoice | null, rules: ExtractedInvoice): ExtractedInvoice {
  if (!ai) return rules

  return {
    supplier: {
      name: pick(ai.supplier.name, rules.supplier.name),
      legalName: pick(ai.supplier.legalName, rules.supplier.legalName),
      vatNo: pick(ai.supplier.vatNo, rules.supplier.vatNo),
      registrationNo: pick(ai.supplier.registrationNo, rules.supplier.registrationNo),
      email: pick(ai.supplier.email, rules.supplier.email),
      phone: pick(ai.supplier.phone, rules.supplier.phone),
      addressLine1: pick(ai.supplier.addressLine1, rules.supplier.addressLine1),
      addressLine2: pick(ai.supplier.addressLine2, rules.supplier.addressLine2),
      city: pick(ai.supplier.city, rules.supplier.city),
      postcode: pick(ai.supplier.postcode, rules.supplier.postcode),
      country: pick(ai.supplier.country, rules.supplier.country),
    },
    invoiceNo: pick(ai.invoiceNo, rules.invoiceNo),
    invoiceDate: pick(ai.invoiceDate, rules.invoiceDate),
    currency: ai.currency ?? rules.currency,
    netAmount: pick(ai.netAmount, rules.netAmount),
    vatAmount: pick(ai.vatAmount, rules.vatAmount),
    grossAmount: pick(ai.grossAmount, rules.grossAmount),
    // An explicit scheme from either reader beats UNKNOWN from the other.
    vatScheme: ai.vatScheme !== 'UNKNOWN' ? ai.vatScheme : rules.vatScheme,
    lines: ai.lines.length >= rules.lines.length ? ai.lines : rules.lines,
  }
}

/** Coerce whatever Claude returned into the shape the rest of the code expects. */
export function coerceExtraction(raw: unknown): ExtractedInvoice | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const supplier = (value.supplier ?? {}) as Record<string, unknown>
  const rawLines = Array.isArray(value.lines) ? value.lines : []

  return {
    supplier: {
      name: str(supplier.name),
      legalName: str(supplier.legalName),
      vatNo: str(supplier.vatNo),
      registrationNo: str(supplier.registrationNo),
      email: str(supplier.email),
      phone: str(supplier.phone),
      addressLine1: str(supplier.addressLine1),
      addressLine2: str(supplier.addressLine2),
      city: str(supplier.city),
      postcode: str(supplier.postcode),
      country: str(supplier.country),
    },
    invoiceNo: str(value.invoiceNo),
    invoiceDate: parseInvoiceDate(str(value.invoiceDate) ?? ''),
    currency: CURRENCIES.includes(value.currency as CurrencyCode) ? value.currency as CurrencyCode : BASE_CURRENCY,
    netAmount: num(value.netAmount),
    vatAmount: num(value.vatAmount),
    grossAmount: num(value.grossAmount),
    vatScheme: VAT_SCHEMES.includes(value.vatScheme as VatScheme) ? value.vatScheme as VatScheme : 'UNKNOWN',
    lines: rawLines.map((line) => {
      const item = (line ?? {}) as Record<string, unknown>
      const quantity = num(item.quantity)
      return {
        description: str(item.description) ?? '',
        brand: str(item.brand),
        reference: str(item.reference),
        serial: str(item.serial),
        year: num(item.year),
        productType: PRODUCT_TYPES.includes(item.productType as ProductType)
          ? item.productType as ProductType
          : DEFAULT_PRODUCT_TYPE,
        unitAmount: num(item.unitAmount),
        vatAmount: num(item.vatAmount),
        quantity: quantity && quantity > 0 ? Math.min(Math.round(quantity), 50) : 1,
      }
    }),
  }
}

const str = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.toLowerCase() !== 'null' ? trimmed : null
}

const num = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return parseAmount(value)
  return null
}
