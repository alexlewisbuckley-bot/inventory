import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { getCatalogue, type CatalogueSort } from '@/server/services/catalogue-service'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { CatalogueGrid } from '@/components/catalogue/CatalogueGrid'
import { isCurrency } from '@/lib/currency'
import { DEFAULT_DISPLAY_CURRENCY, type CurrencyCode } from '@/lib/enums'

export const metadata: Metadata = { title: 'Inventory' }
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

const SORTS: CatalogueSort[] = ['brand', 'trade-desc', 'trade-asc', 'year-desc']

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
  const result = await getCatalogue({
    q: one(searchParams.q),
    brand: one(searchParams.brand),
    sort: SORTS.includes(rawSort as CatalogueSort) ? (rawSort as CatalogueSort) : 'brand',
    page: Number(one(searchParams.page) ?? 1),
    perPage: Number(one(searchParams.perPage) ?? 24),
  }, currency, rates)

  return <CatalogueGrid result={result} currency={currency} />
}
