/**
 * The import format, defined once.
 *
 * The template a user downloads, the parser that reads what they send back and
 * the on-screen guidance all read from this list. When they were written
 * separately the template drifted from the parser and people filled in a column
 * nothing was looking for.
 */
export interface ImportColumn {
  /** Header text, matched case-insensitively on the way back in. */
  header: string
  required: boolean
  /** Shown under the header in the template and in the on-screen guide. */
  hint: string
  /** The value used in the worked example row. */
  example: string
  /** Column width in the generated spreadsheet. */
  width: number
}

export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  // First, because it is the column that decides whether a row is a new
  // purchase or an amendment to one already in stock. An export carries it
  // filled in; a sheet typed from scratch leaves it blank.
  { header: 'Stock No', required: false, hint: 'Blank for new stock', example: '', width: 10 },
  { header: 'Type', required: false, hint: 'Watch if left blank', example: 'Watch', width: 12 },
  { header: 'Brand', required: true, hint: 'Created automatically if new', example: 'Rolex', width: 16 },
  { header: 'Reference', required: true, hint: 'The manufacturer reference', example: '126711CHNR', width: 18 },
  { header: 'Serial', required: false, hint: 'Checked against existing stock', example: '1T41F071', width: 16 },
  { header: 'Supplier', required: true, hint: 'Created automatically if new', example: 'GB Luxury Limited', width: 22 },
  { header: 'Location', required: true, hint: 'Must already exist', example: 'Own inventory', width: 18 },
  { header: 'Owner', required: false, hint: 'Must already exist', example: 'Bluecroft Traders Limited', width: 24 },
  { header: 'Purchase Date', required: true, hint: 'DD/MM/YYYY', example: '08/04/2026', width: 16 },
  { header: 'Purchase Price (USD)', required: true, hint: 'Numbers only', example: '13105.51', width: 20 },
  { header: 'Retail (USD)', required: false, hint: 'Leave blank to price later', example: '14980.00', width: 18 },
] as const

/**
 * Header aliases.
 *
 * "Model" was the header for two versions of this application and is still in
 * every spreadsheet the business already has, so a file exported before the
 * rename must keep importing.
 *
 * "Est Sale" became "Retail" for the same reason, and is aliased the same way.
 *
 * The money headers said GBP until the base moved to dollars. A sheet written
 * against the old headers still loads, and its figures are read as sterling
 * and converted, so re-importing an old export does not silently inflate every
 * price by the exchange rate.
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
  'stock no': 'stock no',
  'stock number': 'stock no',
  'stock #': 'stock no',
  stockno: 'stock no',
  'purchase price': 'purchase price (usd)',
  'purchase price (usd)': 'purchase price (usd)',
  cost: 'purchase price (usd)',
  'cost (usd)': 'purchase price (usd)',
  'est sale': 'est sale (usd)',
  'estimated sale': 'est sale (usd)',
  'est sale price': 'est sale (usd)',
  // The column is called Retail now. The parser key stays as it was because it
  // matches the stored field, so the new header is an alias like the old ones
  // rather than a rename that would stop the freshly downloaded template from
  // importing.
  retail: 'est sale (usd)',
  'retail (usd)': 'est sale (usd)',
  'retail price': 'est sale (usd)',
  'retail (gbp)': 'est sale (gbp)',
  // Left pointing at their own keys, not folded into the dollar ones: a sheet
  // that says GBP holds sterling, and the parser converts it rather than
  // reading the number as though the header had changed under it.
  'purchase price (gbp)': 'purchase price (gbp)',
  'cost (gbp)': 'purchase price (gbp)',
  'est sale (gbp)': 'est sale (gbp)',
}

/** Normalise a header cell to the key the parser looks for. */
export function normaliseHeader(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  return HEADER_ALIASES[key] ?? key
}

export const REQUIRED_HEADERS = IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.header)
export const OPTIONAL_HEADERS = IMPORT_COLUMNS.filter((c) => !c.required).map((c) => c.header)

/** The template as CSV, for anyone who would rather not open a spreadsheet. */
export function templateCsv(): string {
  return [
    IMPORT_COLUMNS.map((c) => c.header).join(','),
    IMPORT_COLUMNS.map((c) => c.example).join(','),
  ].join('\n')
}
