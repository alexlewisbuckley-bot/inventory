import {
  BOX_PAPERS_LABELS, MENS_MIN_MM, WEARS, WEARS_LABELS, WOMENS_MAX_MM, type BoxPapers, type Wears,
} from '@/lib/enums'

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

/**
 * Everything that is ticked.
 *
 * Every group is a list, so somebody can ask for Rolex OR Patek, or two price
 * bands either side of their budget. Within a group the ticks widen the list;
 * across groups they narrow it — the way every shop filter works.
 */
export interface FilterState {
  q: string
  brands: string[]
  /** Indexes into the price bands this stock produced. */
  bands: number[]
  /** Indexes into the case-size bands. */
  sizes: number[]
  boxPapers: string[]
  /** Men's, women's, or both — read off the case size. */
  wears: Wears[]
}

export const NO_FILTERS: FilterState = { q: '', brands: [], bands: [], sizes: [], boxPapers: [], wears: [] }

/** Every tick off, leaving whatever was typed in the search. */
export function clearTicks(state: FilterState): FilterState {
  return { ...NO_FILTERS, q: state.q }
}

/**
 * Who a watch is for, by the same rule as the catalogue and the website.
 *
 * The bands overlap on purpose, so a 36mm piece is both; one with no case
 * size recorded is neither rather than a guess.
 */
export function wearsOf(caseSizeMm: number | null): Wears[] {
  if (caseSizeMm === null) return []
  const out: Wears[] = []
  if (caseSizeMm <= WOMENS_MAX_MM) out.push('WOMENS')
  if (caseSizeMm >= MENS_MIN_MM) out.push('MENS')
  return out
}

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

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
  return fold([
    item.brandName, item.model, item.modelName, item.dial,
    item.caseMaterial, item.bracelet, item.year,
    item.caseSizeMm ? `${item.caseSizeMm}mm` : null,
  ].filter(Boolean).join(' '))
}

/** Lower case, accents off: "Hermès" and "hermes" are the same search. */
function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Letters and digits only, so "126610 LV", "126610-lv" and "126610LV" agree. */
const squash = (text: string) => text.replace(/[^a-z0-9]/g, '')

/**
 * Does this search find this watch?
 *
 * Every word has to be there, in any order: "steel daytona" finds the
 * Daytona whose dial line says steel, which a single substring never did.
 * A reference typed with or without its spaces and hyphens still matches,
 * because nobody types a reference the way it is filed. Two or more words
 * squashed together are also tried as one, so "126610 lv" finds 126610LV.
 */
export function matchesSearch(haystack: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const flat = squash(haystack)
  if (words.length > 1 && flat.includes(squash(words.join('')))) return true
  return words.every((word) => haystack.includes(word) || (squash(word) !== '' && flat.includes(squash(word))))
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
  if (state.q.trim() && !matchesSearch(searchable(item), state.q)) return false
  if (state.brands.length && !state.brands.includes(item.brandName)) return false
  if (state.boxPapers.length && !state.boxPapers.includes(item.boxPapers ?? '')) return false
  if (state.wears.length && !wearsOf(item.caseSizeMm).some((w) => state.wears.includes(w))) return false

  const prices = state.bands.map((i) => bands.price[i]).filter(Boolean) as Counted[]
  if (prices.length && !prices.some((band) => inBand(item.priceGbp, band))) return false

  const sizes = state.sizes.map((i) => bands.size[i]).filter(Boolean) as Counted[]
  if (sizes.length) {
    // A watch with no measurement recorded is not "under 36mm", it is
    // unknown — and putting it in a band would be us making the number up.
    if (item.caseSizeMm === null) return false
    if (!sizes.some((band) => inBand(item.caseSizeMm!, band))) return false
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
  key: 'wears' | 'brand' | 'price' | 'size' | 'boxPapers'
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

  /*
   * Each count is what that one option would show alongside everything
   * ticked in the OTHER groups — so a ticked row keeps its own number and an
   * unticked one says what adding it would bring, not zero.
   */
  const groups: Group[] = [
    {
      key: 'wears',
      title: "Men's & women's",
      active: state.wears.length > 0,
      clear: { wears: [] },
      options: WEARS
        .filter((w) => items.some((item) => wearsOf(item.caseSizeMm).includes(w)))
        .sort((a, b) => (a === 'MENS' ? -1 : b === 'MENS' ? 1 : 0))
        .map((w) => ({
          label: WEARS_LABELS[w],
          count: countWith({ wears: [w] }),
          on: state.wears.includes(w),
          patch: { wears: toggle(state.wears, w) },
        })),
    },
    {
      key: 'brand',
      title: 'Brand',
      active: state.brands.length > 0,
      clear: { brands: [] },
      options: brands.map((name) => ({
        label: name,
        count: countWith({ brands: [name] }),
        on: state.brands.includes(name),
        patch: { brands: toggle(state.brands, name) },
      })),
    },
    {
      key: 'price',
      title: 'Price',
      active: state.bands.length > 0,
      clear: { bands: [] },
      options: bands.price.map((band, index) => ({
        label: band.label,
        count: countWith({ bands: [index] }),
        on: state.bands.includes(index),
        patch: { bands: toggle(state.bands, index) },
      })),
    },
    {
      key: 'size',
      title: 'Case size',
      active: state.sizes.length > 0,
      clear: { sizes: [] },
      options: bands.size.map((band, index) => ({
        label: band.label,
        count: countWith({ sizes: [index] }),
        on: state.sizes.includes(index),
        patch: { sizes: toggle(state.sizes, index) },
      })),
    },
    {
      key: 'boxPapers',
      title: 'Box & papers',
      active: state.boxPapers.length > 0,
      clear: { boxPapers: [] },
      options: boxes.map((value) => ({
        label: BOX_PAPERS_LABELS[value as BoxPapers] ?? value,
        count: countWith({ boxPapers: [value] }),
        on: state.boxPapers.includes(value),
        patch: { boxPapers: toggle(state.boxPapers, value) },
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
  return state.brands.length + state.bands.length + state.sizes.length
    + state.boxPapers.length + state.wears.length
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
    ...state.wears.map((w) => ({ label: WEARS_LABELS[w], patch: { wears: toggle(state.wears, w) } })),
    ...state.brands.map((name) => ({ label: name, patch: { brands: toggle(state.brands, name) } })),
    ...state.bands.filter((i) => bands.price[i]).map((i) => ({
      label: bands.price[i]!.label, patch: { bands: toggle(state.bands, i) },
    })),
    ...state.sizes.filter((i) => bands.size[i]).map((i) => ({
      label: bands.size[i]!.label, patch: { sizes: toggle(state.sizes, i) },
    })),
    ...state.boxPapers.map((value) => ({
      label: BOX_PAPERS_LABELS[value as BoxPapers] ?? value,
      patch: { boxPapers: toggle(state.boxPapers, value) },
    })),
  ]
}
