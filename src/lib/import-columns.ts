import { CURRENCIES, type CurrencyCode } from './enums'

/**
 * The stock sheet, defined once.
 *
 * The template a user downloads, the CSV export, the parser that reads a sheet
 * back in and the on-screen guidance all read from this list. They were written
 * separately, and the export drifted two columns away from the template — which
 * is how you end up with a file the application produced and cannot read.
 *
 * The rule this list exists to enforce: what the export writes, the import
 * accepts. Editing one cell of an export and sending it back is the way stock
 * gets corrected in bulk, so the two shapes have to be the same shape.
 */
export interface ImportColumn {
  /** The canonical key the parser looks for, lower case, no currency suffix. */
  key: string
  /** Header text. Money columns gain a currency suffix — see `headerFor`. */
  label: string
  required: boolean
  /**
   * Written by the export, ignored by the import.
   *
   * Profit and status are derived from other columns or owned by the
   * application, so a sheet cannot set them. They are still exported, because
   * the export is something people read as well as re-upload, and still listed
   * here, because a column the export writes and this list omits is precisely
   * the drift that broke the round trip.
   */
  derived?: boolean
  /** Carries an amount, so the header is suffixed with the currency it is in. */
  money?: boolean
  /** Shown under the header in the template and in the on-screen guide. */
  hint: string
  /** The value used in the worked example row. */
  example: string
  /** Column width in the generated spreadsheet. */
  width: number
}

export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  // First, because it decides whether a row is a new purchase or an amendment
  // to one already in stock. An export carries it filled in; a sheet typed from
  // scratch leaves it blank.
  { key: 'stock no', label: 'Stock No', required: false, hint: 'Blank for new stock', example: '', width: 10 },
  { key: 'type', label: 'Type', required: false, hint: 'Watch if left blank', example: 'Watch', width: 12 },
  { key: 'brand', label: 'Brand', required: true, hint: 'Created automatically if new', example: 'Rolex', width: 16 },
  { key: 'reference', label: 'Reference', required: true, hint: 'The manufacturer reference', example: '126711CHNR', width: 18 },
  { key: 'serial', label: 'Serial', required: false, hint: 'Checked against existing stock', example: '1T41F071', width: 16 },
  { key: 'supplier', label: 'Supplier', required: true, hint: 'Created automatically if new', example: 'GB Luxury Limited', width: 22 },
  { key: 'location', label: 'Location', required: true, hint: 'Must already exist', example: 'Own inventory', width: 18 },
  { key: 'owner', label: 'Owner', required: false, hint: 'Must already exist', example: 'Bluecroft Traders Limited', width: 24 },
  { key: 'purchase date', label: 'Purchase Date', required: true, hint: 'DD/MM/YYYY', example: '08/04/2026', width: 16 },
  { key: 'purchase price', label: 'Purchase Price', required: true, money: true, hint: 'Numbers only', example: '13105.51', width: 20 },
  { key: 'retail', label: 'Retail', required: false, money: true, hint: 'Leave blank to price later', example: '14980.00', width: 18 },
  { key: 'est profit', label: 'Est Profit', required: false, money: true, derived: true, hint: 'Worked out for you', example: '', width: 16 },
  { key: 'status', label: 'Status', required: false, derived: true, hint: 'Set in the application', example: '', width: 14 },
]

/** The columns a sheet can actually set. */
export const WRITABLE_COLUMNS = IMPORT_COLUMNS.filter((c) => !c.derived)

/**
 * The header for one column, in the currency the figures are quoted in.
 *
 * Money columns say which currency they hold, because a sheet of numbers with
 * no unit is the thing somebody reconciles against and gets wrong — and because
 * the parser reads the unit back off the header rather than assuming the base.
 */
export function headerFor(column: ImportColumn, currency: CurrencyCode): string {
  return column.money ? `${column.label} (${currency})` : column.label
}

/** Every header the sheet carries, in order, for a given currency. */
export function headersFor(currency: CurrencyCode): string[] {
  return IMPORT_COLUMNS.map((c) => headerFor(c, currency))
}

/**
 * Header spellings that are not the current label.
 *
 * "Model" was the header for two versions of this application and is still in
 * every spreadsheet the business already has. "Est Sale" became "Retail". A
 * file written against either must keep importing: people do not re-download a
 * template because a column was renamed, they send the sheet they have.
 */
export const HEADER_ALIASES: Record<string, string> = {
  'product type': 'type',
  'item type': 'type',
  category: 'type',
  model: 'reference',
  'model reference': 'reference',
  'reference number': 'reference',
  'stock reference': 'reference',
  'serial number': 'serial',
  'stock number': 'stock no',
  'stock #': 'stock no',
  stockno: 'stock no',
  cost: 'purchase price',
  price: 'purchase price',
  'est sale': 'retail',
  'estimated sale': 'retail',
  'est sale price': 'retail',
  'asking price': 'retail',
  'retail price': 'retail',
  profit: 'est profit',
  'estimated profit': 'est profit',
}

const CURRENCY_SUFFIX = new RegExp(`\\s*\\((${CURRENCIES.join('|')})\\)\\s*$`, 'i')

/**
 * Read a header cell into the key the parser uses and the currency it declares.
 *
 * The currency is taken off the header rather than assumed, so a sheet exported
 * by somebody reading in dirhams comes back in dirhams and is converted, rather
 * than having its numbers read as though they were dollars. Before this, only
 * "(USD)" and "(GBP)" were understood and an AED export failed on every row —
 * a file the application had just written.
 */
export function parseHeader(raw: string): { key: string; currency: CurrencyCode | null } {
  const trimmed = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  const match = trimmed.match(CURRENCY_SUFFIX)
  const currency = match ? (match[1]!.toUpperCase() as CurrencyCode) : null
  const withoutCurrency = match ? trimmed.slice(0, match.index).trim() : trimmed
  return { key: HEADER_ALIASES[withoutCurrency] ?? withoutCurrency, currency }
}

/** Normalise a header cell to the key the parser looks for. */
export function normaliseHeader(raw: string): string {
  return parseHeader(raw).key
}

export const REQUIRED_KEYS = IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.key)
export const REQUIRED_HEADERS = IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.label)
export const OPTIONAL_HEADERS = IMPORT_COLUMNS.filter((c) => !c.required).map((c) => c.label)
