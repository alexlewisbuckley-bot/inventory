import { BOX_PAPERS_LABELS, type BoxPapers } from '@/lib/enums'

/**
 * One filtering system, shared by the two pages that show watches to
 * somebody outside this company.
 *
 * It used to live inside the partner portal, so the campaign page — the one
 * an employee opens when they have won something — had no filtering at all.
 * Alex, looking at it: "Filtering and layout dissapears for winners." A
 * person choosing their ten-year award out of two hundred watches needs the
 * same help as a buyer, and arguably more: they have never done this before.
 *
 * Nothing here touches React, so every rule below is tested directly rather
 * than through a rendered page.
 */

/** Base minor units to something a person reads, in the house currency. */
export function money(base: number): string {
  return `AED ${Math.round(base / 100).toLocaleString('en-GB')}`
}

/** The fields both pages have. Anything optional is extra to search on. */
export interface Filterable {
  brandName: string
  model: string | null
  modelName: string | null
  dial: string | null
  year: number | null
  caseSizeMm: number | null
  boxPapers: string | null
  priceGbp: number
  caseMaterial?: string | null
  bracelet?: string | null
}

export interface FilterState {
  q: string
  brand: string
  /** An index into the price bands this stock produced, or null for any. */
  band: number | null
  /** An index into the case-size bands, or null for any. */
  size: number | null
  boxPapers: string
}

export const NO_FILTERS: FilterState = { q: '', brand: '', band: null, size: null, boxPapers: '' }

export interface Band {
  label: string
  /** Inclusive. Minor units for price, millimetres for size. */
  from: number
  /** Inclusive, and null where the band has no ceiling. */
  to: number | null
}

export interface Counted extends Band {
  count: number
}

/** Everything a row can be searched by, including the words under the picture. */
export function searchable(item: Filterable): string {
  return [
    item.brandName, item.model, item.modelName, item.dial,
    item.caseMaterial, item.bracelet, item.year,
  ].filter(Boolean).join(' ').toLowerCase()
}

/**
 * Price bands, in the round numbers somebody says out loud.
 *
 * Alex: "0-25 25-50 50-100 100-200 250+ OR ALIKE." These are his, in base
 * minor units, with a top band that has no ceiling because the dearest watch
 * in the case moves every week and a band that excluded it would be a band
 * that excluded the piece people most want to look at.
 *
 * Only bands with stock in them come back. A band reading "200k–500k  0" is a
 * tap that leads nowhere, and five of those is a filter that lies about what
 * is in the case.
 */
export function priceBands(items: Array<{ priceGbp: number }>): Counted[] {
  // Whole currency units, because that is how the bands are read out loud.
  // The bounds are converted to minor units; the labels are not.
  const edges = [0, 25_000, 50_000, 100_000, 200_000, 500_000]
  const thousands = (whole: number) => `${Math.round(whole / 1000)}k`

  const ranges: Band[] = []
  for (let index = 0; index < edges.length - 1; index += 1) {
    ranges.push({
      /*
       * "Under 25k", not "0k–25k".
       *
       * Nothing in this building costs nothing, so the zero was a number put
       * there by the loop rather than by anybody who would say it.
       */
      label: index === 0
        ? `Under ${thousands(edges[1])}`
        : `${thousands(edges[index])}–${thousands(edges[index + 1])}`,
      from: edges[index] * 100,
      // Exclusive at the top so a watch at exactly 50k lands in one band and
      // not in two — counts that do not add up to the total are the fastest
      // way to lose somebody's trust in a filter.
      to: edges[index + 1] * 100 - 1,
    })
  }
  ranges.push({ label: `${thousands(edges[edges.length - 1])}+`, from: edges[edges.length - 1] * 100, to: null })

  return countBands(ranges, items.map((item) => item.priceGbp))
}

/**
 * Case sizes, grouped the way a person shops for one.
 *
 * Thirteen separate millimetre chips was what the stock happened to contain,
 * not a question anybody asks: nobody wants a 41 and refuses a 42. Four bands
 * covers the real decision — small, classic, modern, large — and keeps the
 * rail four rows instead of thirteen.
 */
export function sizeBands(items: Array<{ caseSizeMm: number | null }>): Counted[] {
  const ranges: Band[] = [
    { label: 'Under 36mm', from: 0, to: 35 },
    { label: '36–39mm', from: 36, to: 39 },
    { label: '40–42mm', from: 40, to: 42 },
    { label: '43mm and over', from: 43, to: null },
  ]
  const sizes = items.map((item) => item.caseSizeMm).filter((mm): mm is number => mm !== null)
  return countBands(ranges, sizes)
}

function countBands(ranges: Band[], values: number[]): Counted[] {
  return ranges
    .map((range) => ({
      ...range,
      count: values.filter((value) => inBand(value, range)).length,
    }))
    .filter((range) => range.count > 0)
}

function inBand(value: number, band: Band): boolean {
  return value >= band.from && (band.to === null || value <= band.to)
}

/** Does this watch survive every filter that is on? */
export function matches(
  item: Filterable,
  state: FilterState,
  bands: { price: Counted[]; size: Counted[] },
): boolean {
  const needle = state.q.trim().toLowerCase()
  if (needle && !searchable(item).includes(needle)) return false
  if (state.brand && item.brandName !== state.brand) return false
  if (state.boxPapers && item.boxPapers !== state.boxPapers) return false

  const price = state.band !== null ? bands.price[state.band] : null
  if (price && !inBand(item.priceGbp, price)) return false

  const size = state.size !== null ? bands.size[state.size] : null
  if (size) {
    // A watch with no measurement recorded is not "under 36mm", it is
    // unknown — and putting it in a band would be us making the number up.
    if (item.caseSizeMm === null) return false
    if (!inBand(item.caseSizeMm, size)) return false
  }

  return true
}

export function applyFilters<T extends Filterable>(
  items: T[],
  state: FilterState,
  bands: { price: Counted[]; size: Counted[] },
): T[] {
  return items.filter((item) => matches(item, state, bands))
}

export interface Option {
  label: string
  /** What the list would come back as if this were tapped. */
  count: number
  on: boolean
  /** The change this option makes, applied over the current state. */
  patch: Partial<FilterState>
}

export interface Group {
  key: 'brand' | 'price' | 'size' | 'boxPapers'
  title: string
  options: Option[]
  /** Whether anything in this group is on, for its own clear link. */
  active: boolean
  clear: Partial<FilterState>
}

/**
 * The filter rail, worked out from the stock in front of us.
 *
 * Two rules make this feel like a shop rather than a form:
 *
 * The options come from the stock. A brand row offering Patek when there is
 * no Patek in the building returns nothing, which reads as the page being
 * broken rather than as us not having one.
 *
 * Every count is what you would get IF you tapped it — so choosing Rolex
 * re-counts the sizes against Rolex only, and a row that would empty the page
 * says 0 before you waste the tap on it.
 */
export function buildGroups(items: Filterable[], state: FilterState): Group[] {
  const bands = { price: priceBands(items), size: sizeBands(items) }
  const countWith = (patch: Partial<FilterState>) =>
    applyFilters(items, { ...state, ...patch }, bands).length

  const brandCounts = new Map<string, number>()
  for (const item of items) {
    brandCounts.set(item.brandName, (brandCounts.get(item.brandName) ?? 0) + 1)
  }
  /*
   * Biggest first, not alphabetical.
   *
   * "Rolex 178" says how much of the case it is before anybody taps it, and
   * ordering by size puts the one most people want at the top of the rail
   * rather than wherever the alphabet left it.
   */
  const brands = [...brandCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)

  const boxes = [...new Set(items
    .map((item) => item.boxPapers)
    .filter((value): value is string => Boolean(value) && value !== 'UNKNOWN'))].sort()

  const groups: Group[] = [
    {
      key: 'brand',
      title: 'Brand',
      active: state.brand !== '',
      clear: { brand: '' },
      options: brands.map((name) => ({
        label: name,
        count: countWith({ brand: name }),
        on: state.brand === name,
        patch: { brand: state.brand === name ? '' : name },
      })),
    },
    {
      key: 'price',
      title: 'Price',
      active: state.band !== null,
      clear: { band: null },
      options: bands.price.map((band, index) => ({
        label: band.label,
        count: countWith({ band: index }),
        on: state.band === index,
        patch: { band: state.band === index ? null : index },
      })),
    },
    {
      key: 'size',
      title: 'Case size',
      active: state.size !== null,
      clear: { size: null },
      options: bands.size.map((band, index) => ({
        label: band.label,
        count: countWith({ size: index }),
        on: state.size === index,
        patch: { size: state.size === index ? null : index },
      })),
    },
    {
      key: 'boxPapers',
      title: 'Box & papers',
      active: state.boxPapers !== '',
      clear: { boxPapers: '' },
      options: boxes.map((value) => ({
        label: BOX_PAPERS_LABELS[value as BoxPapers] ?? value,
        count: countWith({ boxPapers: value }),
        on: state.boxPapers === value,
        patch: { boxPapers: state.boxPapers === value ? '' : value },
      })),
    },
  ]

  /*
   * A group with one option is not a choice.
   *
   * If every watch in the campaign is a Rolex, a Brand heading with one row
   * under it is a control that can only ever do nothing, and four of those is
   * the difference between a rail that helps and a rail that is furniture.
   */
  return groups.filter((group) => group.options.length > 1)
}

/** How many filters are on, for the badge on the button that opens them. */
export function activeCount(state: FilterState): number {
  return [
    state.brand !== '',
    state.band !== null,
    state.size !== null,
    state.boxPapers !== '',
  ].filter(Boolean).length
}

export interface Pill {
  label: string
  patch: Partial<FilterState>
}

/**
 * What is applied, as things that can be taken off one at a time.
 *
 * The worst state in a filtered list is an empty one whose cause is
 * off-screen — somebody sets a price band, scrolls, searches for a Daytona
 * and concludes we have none.
 */
export function pillsFor(items: Filterable[], state: FilterState): Pill[] {
  const bands = { price: priceBands(items), size: sizeBands(items) }
  return [
    ...(state.q ? [{ label: `“${state.q}”`, patch: { q: '' } }] : []),
    ...(state.brand ? [{ label: state.brand, patch: { brand: '' } }] : []),
    ...(state.band !== null && bands.price[state.band]
      ? [{ label: bands.price[state.band].label, patch: { band: null } }]
      : []),
    ...(state.size !== null && bands.size[state.size]
      ? [{ label: bands.size[state.size].label, patch: { size: null } }]
      : []),
    ...(state.boxPapers
      ? [{
        label: BOX_PAPERS_LABELS[state.boxPapers as BoxPapers] ?? state.boxPapers,
        patch: { boxPapers: '' },
      }]
      : []),
  ]
}
