import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { getCatalogue, type CatalogueSort } from '@/server/services/catalogue-service'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { PageHeader } from '@/components/layout/PageHeader'
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
 * The whole page is a read. There is no edit control to hide and no action to
 * forbid, because none is rendered — the only mutation a dealer could want is
 * to buy something, and that is a conversation rather than a button.
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
    quotedOnly: one(searchParams.quotedOnly) === 'true',
    sort: SORTS.includes(rawSort as CatalogueSort) ? (rawSort as CatalogueSort) : 'brand',
    page: Number(one(searchParams.page) ?? 1),
    perPage: Number(one(searchParams.perPage) ?? 24),
  }, currency, rates)

  return (
    <>
      <PageHeader
        title="Inventory"
        description={result.total > 0
          ? `${result.total} ${result.total === 1 ? 'piece' : 'pieces'} available at trade.`
          : 'Everything currently available to the trade.'}
      />
      <CatalogueGrid result={result} currency={currency} />
    </>
  )
}
