import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { catalogueFacets, getCatalogue, type CatalogueSort } from '@/server/services/catalogue-service'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { CatalogueGrid } from '@/components/catalogue/CatalogueGrid'
import { isCurrency } from '@/lib/currency'
import {
  BOX_PAPERS, CONDITIONS, DEFAULT_DISPLAY_CURRENCY, WEARS,
  type BoxPapers, type Condition, type CurrencyCode, type Wears,
} from '@/lib/enums'

export const metadata: Metadata = { title: 'Inventory' }
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

const SORTS: CatalogueSort[] = ['brand', 'trade-desc', 'trade-asc', 'year-desc']

/**
 * A closed list is only closed if something checks.
 *
 * These reach the query as values compared against enum columns, so an
 * unknown one is a type error at best and a confusing empty grid at
 * worst. Anything not on the list is simply not a filter.
 */
const oneOf = <T extends string>(allowed: readonly T[], raw: string | undefined): T | undefined =>
  (raw && (allowed as readonly string[]).includes(raw) ? raw as T : undefined)

/** A positive whole number, or no filter at all. */
const num = (raw: string | undefined): number | undefined => {
  const value = Number(raw)
  return raw && Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * What a trade partner sees when they sign in.
 *
 * Almost the whole page is a read: there is no edit control to hide, because
 * none is rendered. The one thing a dealer can do is say they want something,
 * and that opens a conversation rather than a sale — an enquiry, which an
 * owner answers and may turn into a deal. The distinction is the point: a
 * board anybody can write to is a board nobody reads.
 */
export default async function CataloguePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireCapability('catalogue:read')
  const [rates, preferences] = await Promise.all([getRateTable(), getPreferencesFor(user.id)])
  const currency: CurrencyCode = isCurrency(preferences?.displayCurrency)
    ? preferences.displayCurrency
    : DEFAULT_DISPLAY_CURRENCY

  const rawSort = one(searchParams.sort)
  const query = {
    q: one(searchParams.q),
    brand: one(searchParams.brand),
    family: one(searchParams.family),
    dial: one(searchParams.dial),
    material: one(searchParams.material),
    wears: oneOf<Wears>(WEARS, one(searchParams.wears)),
    size: num(one(searchParams.size)),
    year: num(one(searchParams.year)),
    condition: oneOf<Condition>(CONDITIONS, one(searchParams.condition)),
    boxPapers: oneOf<BoxPapers>(BOX_PAPERS, one(searchParams.boxPapers)),
    sort: SORTS.includes(rawSort as CatalogueSort) ? (rawSort as CatalogueSort) : 'brand' as CatalogueSort,
    page: Number(one(searchParams.page) ?? 1),
    perPage: Number(one(searchParams.perPage) ?? 24),
  }

  // The menus are counted against the same filters the grid is, minus
  // each menu's own, so picking one narrows the rest without closing the
  // door on going back.
  const [result, facets] = await Promise.all([
    getCatalogue(query, currency, rates),
    catalogueFacets(query),
  ])

  return <CatalogueGrid result={result} facets={facets} currency={currency} />
}
