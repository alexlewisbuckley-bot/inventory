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
  supplier: { name: null, legalName: null, vatNo: null, registrationNo: null, email: null, phone: null, country: null },
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

/**
 * Read what can be read from the invoice's text layer.
 *
 * Conservative on purpose. A line becomes stock only when it carries both an
 * identity (a brand or a reference) and a price — the two things a watch
 * cannot be booked in without. Everything else is left for Claude or reported
 * as an issue, because a confidently wrong row in the stock list costs more
 * than a row that says it needs attention.
 */
export function parseInvoiceText(text: string, extraBrands: string[] = []): ExtractedInvoice {
  const brands = [...new Set([...KNOWN_BRANDS, ...extraBrands])]
    .filter((b) => b.trim().length > 1)
    .sort((a, b) => b.length - a.length)

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const whole = lines.join('\n')

  const currency = CURRENCY_HINTS.find(([pattern]) => pattern.test(whole))?.[1] ?? BASE_CURRENCY

  const invoiceNo = firstMatch(whole, [
    /invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i,
    /\binv\s*[:\-#]\s*([A-Z0-9][A-Z0-9\-/]{2,})/i,
  ])

  const invoiceDate = parseInvoiceDate(
    firstMatch(whole, [
      /(?:invoice\s*date|date\s*of\s*invoice|dated)\s*[:\-]?\s*([^\n]{6,30})/i,
      /\bdate\s*[:\-]\s*([^\n]{6,30})/i,
    ]) ?? '',
  )

  const supplier = parseSupplier(lines, whole)

  const netAmount = parseAmount(firstMatch(whole, [/(?:sub\s*total|net\s*(?:total|amount)?)\s*[:\-]?\s*([£$]?[\d,. ]+)/i]))
  // "VAT Reg No: GB 384 2910 55" is not a VAT amount, and reading it as one
  // put £3.8m of tax on a £26k invoice. A figure only counts as the VAT total
  // if it carries a currency symbol or pence, and never straight after the
  // words that introduce a registration number.
  const vatAmount = parseAmount(firstMatch(whole, [
    /\bvat\b(?!\s*(?:reg|registration|no\b|number|id\b))[^\n\d]{0,15}?([£$]\s?[\d,]+(?:\.\d{2})?)/i,
    /\bvat\b(?!\s*(?:reg|registration|no\b|number|id\b))[^\n\d]{0,15}?\b([\d,]+\.\d{2})\b/i,
  ]))
  const grossAmount = parseAmount(firstMatch(whole, [
    /(?:total\s*(?:due|payable|amount)?|amount\s*due|balance\s*due|grand\s*total)\s*[:\-]?\s*([£$]?[\d,. ]+)/i,
  ]))

  return {
    supplier,
    invoiceNo,
    invoiceDate,
    currency,
    netAmount,
    vatAmount,
    grossAmount,
    vatScheme: detectVatScheme(whole),
    lines: lines.flatMap((line) => parseLine(line, brands) ?? []),
  }
}

function parseLine(line: string, brands: string[]): ExtractedLine | null {
  if (NOISE_LINE.test(line)) return null

  const brand = brands.find((candidate) => line.toLowerCase().includes(candidate.toLowerCase())) ?? null

  // The price is the last money-shaped figure on the line: an invoice row runs
  // description → unit → total, and the rightmost is the one that was charged.
  const amounts = [...line.matchAll(/[£$]?\s?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|[£$]\s?\d+(?:\.\d{2})?|\b\d{4,}\.\d{2}\b/g)]
    .map((match) => parseAmount(match[0]))
    .filter((value): value is number => value !== null)
  const unitAmount = amounts.length > 0 ? amounts[amounts.length - 1]! : null

  const serial = firstMatch(line, [/(?:serial|s\/n|serial\s*no\.?)\s*[:\-]?\s*([A-Z0-9]{4,12})/i])

  // Look for the reference in what is left once the brand, the serial and the
  // money have been taken out — otherwise "12,500.00" reads as a reference.
  let remainder = line
  if (brand) remainder = remainder.replace(new RegExp(escapeRegExp(brand), 'ig'), ' ')
  if (serial) remainder = remainder.replace(serial, ' ')
  remainder = remainder.replace(/[£$]?\s?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|[£$]\s?\d+(?:\.\d{2})?|\d+\.\d{2}\b/g, ' ')
  const year = yearIn(remainder)
  if (year) remainder = remainder.replace(String(year), ' ')

  const reference = REFERENCE.exec(remainder)?.[0]?.trim() ?? null

  if (!unitAmount || (!brand && !reference)) return null

  return {
    description: line,
    brand,
    reference,
    serial,
    year,
    productType: DEFAULT_PRODUCT_TYPE,
    unitAmount,
    vatAmount: null,
    quantity: 1,
  }
}

/**
 * Who sent it.
 *
 * The letterhead is the top of the document, so the name is looked for there
 * first — but only above the "invoice to"/"bill to" block, because below it is
 * the buyer, and booking stock in against yourself is the one mistake that
 * would be silently self-consistent.
 */
function parseSupplier(lines: string[], whole: string): ExtractedSupplier {
  const buyerAt = lines.findIndex((line) => /^(invoice\s*to|bill\s*to|sold\s*to|customer)\b/i.test(line))
  const letterhead = (buyerAt > 0 ? lines.slice(0, buyerAt) : lines.slice(0, 8))
    .filter((line) => !/^(tax\s*)?invoice$/i.test(line) && !NOISE_LINE.test(line))

  const named = firstMatch(whole, [/(?:from|supplier|vendor|seller)\s*[:\-]\s*([^\n]{2,80})/i])
  const legalName = letterhead.find((line) => /\b(limited|ltd\.?|llp|plc|gmbh|s\.?a\.?r\.?l\.?|inc\.?|b\.?v\.?)\b/i.test(line)) ?? null

  return {
    name: (named ?? letterhead[0] ?? legalName)?.trim() ?? null,
    legalName: legalName?.trim() ?? null,
    vatNo: firstMatch(whole, [
      /\bvat\s*(?:reg(?:istration)?\.?\s*)?(?:no\.?|number|#)?\s*[:\-]?\s*((?:GB|IE|FR|DE|NL|IT|ES)?\s?\d[\d\s]{6,14})/i,
    ])?.replace(/\s+/g, '') ?? null,
    registrationNo: firstMatch(whole, [
      /(?:company|co\.?|reg(?:istration)?)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z]{0,2}\d{6,8})/i,
    ]) ?? null,
    email: firstMatch(whole, [/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/]),
    phone: firstMatch(whole, [/(?:tel|phone|mob(?:ile)?)\s*[:\-]?\s*(\+?[\d\s()-]{9,20})/i])?.trim() ?? null,
    country: firstMatch(whole, [/\b(United Kingdom|England|Scotland|Wales|Switzerland|United Arab Emirates|UAE|Hong Kong|Italy|France|Germany|USA|United States)\b/i]),
  }
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
