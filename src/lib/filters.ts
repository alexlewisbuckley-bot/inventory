import {
  CONDITIONS, CONDITION_LABELS, CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS,
  CUSTOMER_TIERS, CUSTOMER_TIER_LABELS, CUSTOMER_TYPES, CUSTOMER_TYPE_LABELS,
  DELIVERY_STATUSES, DELIVERY_STATUS_LABELS, LEAD_SOURCES, LEAD_SOURCE_LABELS,
  PAYMENT_STATUSES, PAYMENT_STATUS_LABELS, SALE_CHANNELS, SALE_CHANNEL_LABELS,
  WATCH_STATUSES, WATCH_STATUS_LABELS,
} from './enums'

/**
 * One filter grammar for every list.
 *
 * V1 gave each list its own bespoke query parameters — `status` repeated,
 * `unpricedOnly=true`, `minPrice`, `locationId` — which meant every new filter
 * was a new parameter, a new parser and a new thing for the URL to get wrong.
 * Worse, it made a filter *expressible only if somebody had built a control
 * for it*: there was no way to ask for "cost over £10,000 and not in the
 * vault" because nothing on the toolbar offered that combination.
 *
 * A field/operator/value model fixes both. The list of fields is data, the
 * operators come from the field's type, and the URL carries clauses rather
 * than named parameters. Adding a filterable column becomes one entry in a
 * table instead of a change in four files.
 *
 * ## The wire format
 *
 * Clauses ride in repeated `f` parameters, `field:operator:value|value`:
 *
 *   ?f=status:is:IN_STOCK|RESERVED&f=purchasePriceGbp:gt:1000000
 *
 * Readable, hand-editable, and short enough to paste into a message — which
 * matters, because a filtered list that cannot be sent to a colleague is a
 * filtered list that gets described down a phone instead.
 *
 * ## Hostile input
 *
 * Everything arriving from a URL is assumed to be wrong. Unknown fields,
 * operators a field does not support, enum values that are not in the enum,
 * numbers that are not numbers, and absurd clause counts are all dropped
 * silently rather than thrown — a shared link with one stale filter in it
 * should still open the list, not an error page.
 */

export type FilterOperator =
  | 'is' | 'isNot'
  | 'contains' | 'notContains'
  | 'gt' | 'lt'
  | 'before' | 'after'
  | 'isEmpty' | 'isNotEmpty'

export type FieldType = 'enum' | 'text' | 'number' | 'money' | 'date' | 'boolean' | 'reference'

export interface FieldSpec {
  key: string
  label: string
  type: FieldType
  /** Enum options, or reference options supplied at runtime (locations, brands). */
  options?: ReadonlyArray<{ value: string; label: string }>
  /** Reference fields load their options from the server; this names the set. */
  optionSource?: string
  /** Overrides the default operators for the type. */
  operators?: readonly FilterOperator[]
}

export interface FilterClause {
  field: string
  operator: FilterOperator
  /** Empty for `isEmpty` / `isNotEmpty`. Multiple values mean "any of". */
  values: string[]
}

/**
 * Which operators a type offers.
 *
 * Deliberately short lists. A filter builder that offers eleven operators on a
 * text field is a filter builder people close again — nobody has ever wanted
 * "does not start with" on a supplier name, and offering it costs everybody
 * else a longer menu.
 */
const OPERATORS_FOR: Record<FieldType, readonly FilterOperator[]> = {
  enum: ['is', 'isNot'],
  reference: ['is', 'isNot'],
  text: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
  number: ['gt', 'lt', 'is', 'isEmpty', 'isNotEmpty'],
  // "Is empty" on a price is the unpriced-stock query, which is the single
  // most-used filter in the product. Leaving it off a money field would have
  // meant keeping `unpricedOnly=true` as a special case forever.
  money: ['gt', 'lt', 'isEmpty', 'isNotEmpty'],
  date: ['after', 'before', 'isEmpty', 'isNotEmpty'],
  boolean: ['is'],
}

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: 'is',
  isNot: 'is not',
  contains: 'contains',
  notContains: 'does not contain',
  gt: 'is over',
  lt: 'is under',
  after: 'is after',
  before: 'is before',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
}

/** Operators that take no value at all. */
const VALUELESS: ReadonlySet<FilterOperator> = new Set(['isEmpty', 'isNotEmpty'])

export function operatorsFor(field: FieldSpec): readonly FilterOperator[] {
  return field.operators ?? OPERATORS_FOR[field.type]
}

// ---------------------------------------------------------------------------
// Field specifications, per object
// ---------------------------------------------------------------------------

const enumOptions = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }))

export const WATCH_FIELDS: readonly FieldSpec[] = [
  { key: 'status', label: 'Status', type: 'enum', options: enumOptions(WATCH_STATUSES, WATCH_STATUS_LABELS) },
  { key: 'condition', label: 'Condition', type: 'enum', options: enumOptions(CONDITIONS, CONDITION_LABELS) },
  { key: 'brandId', label: 'Brand', type: 'reference', optionSource: 'brands' },
  { key: 'locationId', label: 'Location', type: 'reference', optionSource: 'locations' },
  { key: 'supplierId', label: 'Supplier', type: 'reference', optionSource: 'suppliers' },
  { key: 'model', label: 'Model', type: 'text' },
  { key: 'serial', label: 'Serial', type: 'text' },
  { key: 'purchasePriceGbp', label: 'Cost', type: 'money' },
  { key: 'estSaleGbp', label: 'Asking price', type: 'money' },
  { key: 'purchaseDate', label: 'Bought', type: 'date' },
  { key: 'year', label: 'Year', type: 'number' },
]

export const CONTACT_FIELDS: readonly FieldSpec[] = [
  { key: 'customerType', label: 'Side', type: 'enum', options: enumOptions(CUSTOMER_TYPES, CUSTOMER_TYPE_LABELS) },
  { key: 'tier', label: 'Tier', type: 'enum', options: enumOptions(CUSTOMER_TIERS, CUSTOMER_TIER_LABELS) },
  { key: 'status', label: 'Status', type: 'enum', options: enumOptions(CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS) },
  { key: 'leadSource', label: 'Came from', type: 'enum', options: enumOptions(LEAD_SOURCES, LEAD_SOURCE_LABELS) },
  { key: 'ownerId', label: 'Looked after by', type: 'reference', optionSource: 'users' },
  { key: 'company', label: 'Company', type: 'text' },
  { key: 'country', label: 'Country', type: 'text' },
  { key: 'lastContactedAt', label: 'Last spoken to', type: 'date' },
]

export const SALE_FIELDS: readonly FieldSpec[] = [
  { key: 'channel', label: 'Channel', type: 'enum', options: enumOptions(SALE_CHANNELS, SALE_CHANNEL_LABELS) },
  { key: 'paymentStatus', label: 'Payment', type: 'enum', options: enumOptions(PAYMENT_STATUSES, PAYMENT_STATUS_LABELS) },
  { key: 'deliveryStatus', label: 'Delivery', type: 'enum', options: enumOptions(DELIVERY_STATUSES, DELIVERY_STATUS_LABELS) },
  { key: 'saleAmountGbp', label: 'Amount', type: 'money' },
  { key: 'profitGbp', label: 'Profit', type: 'money' },
  { key: 'saleDate', label: 'Sold', type: 'date' },
]

export const FIELD_SETS = {
  watch: WATCH_FIELDS,
  contact: CONTACT_FIELDS,
  sale: SALE_FIELDS,
} as const

export type ObjectKind = keyof typeof FIELD_SETS

// ---------------------------------------------------------------------------
// Encoding and decoding
// ---------------------------------------------------------------------------

/** Beyond this a URL is being used as a database, and something has gone wrong. */
const MAX_CLAUSES = 20
const MAX_VALUES = 40
const MAX_VALUE_LENGTH = 120

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))

/**
 * Is this clause coherent for its field?
 *
 * Split out from parsing so it can be reused when a clause is built in the
 * interface — the same rules decide what the builder may offer and what the
 * URL is allowed to say, which is the only way those two can agree.
 */
export function validateClause(clause: FilterClause, fields: readonly FieldSpec[]): FilterClause | null {
  const field = fields.find((spec) => spec.key === clause.field)
  if (!field) return null
  if (!operatorsFor(field).includes(clause.operator)) return null

  if (VALUELESS.has(clause.operator)) {
    return { field: field.key, operator: clause.operator, values: [] }
  }

  let values = clause.values
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= MAX_VALUE_LENGTH)
    .slice(0, MAX_VALUES)

  if (field.type === 'enum') {
    const allowed = new Set(field.options?.map((option) => option.value))
    values = values.filter((value) => allowed.has(value))
  }

  if (field.type === 'number' || field.type === 'money') {
    values = values.filter((value) => /^-?\d+(\.\d+)?$/.test(value))
    // "over 5000 or over 9000" is not a filter anybody means. Comparison
    // operators take exactly one value; extra ones are somebody hand-editing a
    // URL, and the first is the only defensible reading.
    values = values.slice(0, 1)
  }

  if (field.type === 'date') {
    values = values.filter(isIsoDate).slice(0, 1)
  }

  if (field.type === 'boolean') {
    values = values.filter((value) => value === 'true' || value === 'false').slice(0, 1)
  }

  if (values.length === 0) return null
  // Duplicates in an "any of" list change nothing and make the chip lie about
  // how many things are selected.
  return { field: field.key, operator: clause.operator, values: [...new Set(values)] }
}

/** `status:is:IN_STOCK|RESERVED` → a clause, or null if it is nonsense. */
export function parseClause(raw: string, fields: readonly FieldSpec[]): FilterClause | null {
  // Split on the first two colons only: a text value may legitimately contain
  // one, and `model:contains:GMT-Master II: 1675` must not lose its tail.
  const first = raw.indexOf(':')
  if (first < 1) return null
  const second = raw.indexOf(':', first + 1)

  const field = raw.slice(0, first)
  const operator = (second === -1 ? raw.slice(first + 1) : raw.slice(first + 1, second)) as FilterOperator
  const rest = second === -1 ? '' : raw.slice(second + 1)

  return validateClause({ field, operator, values: rest ? rest.split('|') : [] }, fields)
}

export function encodeClause(clause: FilterClause): string {
  if (VALUELESS.has(clause.operator)) return `${clause.field}:${clause.operator}`
  return `${clause.field}:${clause.operator}:${clause.values.join('|')}`
}

/**
 * Every valid clause in a query string, in the order they appear.
 *
 * Silently drops what it cannot understand. A link somebody shared six months
 * ago, carrying a filter on a column that has since been renamed, should open
 * the list with the filters that still make sense rather than an error page —
 * the recipient did nothing wrong and cannot fix it.
 */
export function parseFilters(
  params: URLSearchParams | string,
  fields: readonly FieldSpec[],
): FilterClause[] {
  const search = typeof params === 'string' ? new URLSearchParams(params) : params
  const clauses: FilterClause[] = []
  const seen = new Set<string>()

  for (const raw of search.getAll('f').slice(0, MAX_CLAUSES)) {
    const clause = parseClause(raw, fields)
    if (!clause) continue
    // One clause per field/operator pair. Two `status:is` clauses is somebody
    // clicking twice, and honouring both would AND them into nothing.
    const key = `${clause.field}:${clause.operator}`
    if (seen.has(key)) continue
    seen.add(key)
    clauses.push(clause)
  }

  return clauses
}

/** Write clauses back into a query string, leaving every other parameter alone. */
export function applyFilters(params: URLSearchParams, clauses: FilterClause[]): URLSearchParams {
  const next = new URLSearchParams(params.toString())
  next.delete('f')
  for (const clause of clauses.slice(0, MAX_CLAUSES)) next.append('f', encodeClause(clause))
  // Any change to the filter set invalidates the page number: page 4 of a
  // narrower result is usually empty, which reads as "no matches".
  next.delete('page')
  return next
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

/**
 * A clause as a person would say it.
 *
 * Used on the chip and in the "no matches" message. The second is the one that
 * matters: an empty list that says "nothing matched" is a dead end, and one
 * that says "nothing is in stock, over £10,000, bought before March" tells the
 * reader which condition to relax.
 */
export function describeClause(
  clause: FilterClause,
  fields: readonly FieldSpec[],
  resolve?: (field: string, value: string) => string | undefined,
): string {
  const field = fields.find((spec) => spec.key === clause.field)
  if (!field) return clause.field

  if (VALUELESS.has(clause.operator)) {
    return `${field.label} ${OPERATOR_LABELS[clause.operator]}`
  }

  const labelled = clause.values.map((value) => {
    const fromOptions = field.options?.find((option) => option.value === value)?.label
    return fromOptions ?? resolve?.(field.key, value) ?? formatValue(field, value)
  })

  const joined = labelled.length === 1
    ? labelled[0]!
    // "any of" rather than a bare comma list: "Status is In stock, Reserved"
    // reads as a conjunction and means the opposite of what it does.
    : `any of ${labelled.slice(0, -1).join(', ')} or ${labelled[labelled.length - 1]}`

  return `${field.label} ${OPERATOR_LABELS[clause.operator]} ${joined}`
}

function formatValue(field: FieldSpec, value: string): string {
  if (field.type === 'money') {
    const major = Number(value)
    return Number.isFinite(major) ? `£${major.toLocaleString('en-GB')}` : value
  }
  if (field.type === 'date') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  return value
}

/** The whole filter set as one sentence, for an empty state. */
export function describeFilters(
  clauses: FilterClause[],
  fields: readonly FieldSpec[],
  resolve?: (field: string, value: string) => string | undefined,
): string {
  if (clauses.length === 0) return ''
  return clauses.map((clause) => describeClause(clause, fields, resolve)).join(', and ')
}

/**
 * Next's searchParams, as a URLSearchParams the filter parser understands.
 *
 * Next hands over `Record<string, string | string[]>`; the grammar reads
 * repeated keys. Written once here rather than three times, because the shape
 * with the array in it is exactly where a hand-rolled conversion drops the
 * second clause and nobody notices.
 */
export function toSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item)
  }
  return params
}
