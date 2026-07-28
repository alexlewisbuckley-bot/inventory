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
  { header: 'Brand', required: true, hint: 'Created automatically if new', example: 'Rolex', width: 16 },
  { header: 'Reference', required: true, hint: 'The manufacturer reference', example: '126711CHNR', width: 18 },
  { header: 'Serial', required: false, hint: 'Checked against existing stock', example: '1T41F071', width: 16 },
  { header: 'Supplier', required: true, hint: 'Created automatically if new', example: 'GB Luxury Limited', width: 22 },
  { header: 'Location', required: true, hint: 'Must already exist', example: 'Own inventory', width: 18 },
  { header: 'Purchase Date', required: true, hint: 'DD/MM/YYYY', example: '08/04/2026', width: 16 },
  { header: 'Purchase Price (GBP)', required: true, hint: 'Numbers only', example: '13105.51', width: 20 },
  { header: 'Est Sale (GBP)', required: false, hint: 'Leave blank to price later', example: '14980.00', width: 18 },
] as const

/**
 * Header aliases.
 *
 * "Model" was the header for two versions of this application and is still in
 * every spreadsheet the business already has, so a file exported before the
 * rename must keep importing. Likewise the estimate used to be quoted in
 * dollars; a sheet with that header still loads, and the value is treated as
 * dollars so the figure is not silently reinterpreted as sterling.
 */
export const HEADER_ALIASES: Record<string, string> = {
  model: 'reference',
  'model reference': 'reference',
  'reference number': 'reference',
  'stock reference': 'reference',
  'serial number': 'serial',
  'purchase price': 'purchase price (gbp)',
  'cost (gbp)': 'purchase price (gbp)',
  cost: 'purchase price (gbp)',
  'est sale': 'est sale (gbp)',
  'estimated sale': 'est sale (gbp)',
  'est sale price': 'est sale (gbp)',
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
