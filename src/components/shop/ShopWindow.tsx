'use client'
import { useMemo, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import {
  BOX_PAPERS_LABELS, CONDITION_LABELS,
  type BoxPapers, type Condition, type CurrencyCode,
} from '@/lib/enums'

export interface ShopItem {
  id: string
  brandName: string
  model: string
  nickname: string | null
  year: number | null
  condition: string
  boxPapers: string
  productType: string
  price: number | null
  imageId: string | null
}

type Sort = 'brand' | 'price-desc' | 'price-asc' | 'year-desc'

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'brand', label: 'Brand A–Z' },
  { value: 'price-desc', label: 'Price, high to low' },
  { value: 'price-asc', label: 'Price, low to high' },
  { value: 'year-desc', label: 'Newest first' },
]

/**
 * The reseller's shop floor.
 *
 * Filtering happens here rather than on the server because the whole catalogue
 * is a few hundred rows at most and it is already on the page: a customer
 * narrowing by brand should not wait for a round trip, and this page has no
 * session to hang a server-side query state off.
 */
export function ShopWindow({ items, token, currency, contactEmail }: {
  items: ShopItem[]
  token: string
  currency: CurrencyCode
  contactEmail: string | null
}) {
  const [query, setQuery] = useState('')
  const [brand, setBrand] = useState('')
  const [sort, setSort] = useState<Sort>('brand')
  const [pricedOnly, setPricedOnly] = useState(false)

  const brands = useMemo(
    () => [...new Set(items.map((i) => i.brandName))].sort((a, b) => a.localeCompare(b)),
    [items],
  )

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = items.filter((item) => {
      if (brand && item.brandName !== brand) return false
      if (pricedOnly && item.price === null) return false
      if (!needle) return true
      return [item.brandName, item.model, item.nickname, item.year ? String(item.year) : null]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle))
    })

    // Unpriced pieces sort to the end of a price sort rather than counting as
    // zero, which would put the most expensive-looking wall of "on request"
    // at the top of a list somebody asked to see cheapest first.
    const byPrice = (a: ShopItem, b: ShopItem, dir: number) => {
      if (a.price === null && b.price === null) return 0
      if (a.price === null) return 1
      if (b.price === null) return -1
      return (a.price - b.price) * dir
    }

    return [...filtered].sort((a, b) => {
      if (sort === 'price-desc') return byPrice(a, b, -1)
      if (sort === 'price-asc') return byPrice(a, b, 1)
      if (sort === 'year-desc') return (b.year ?? 0) - (a.year ?? 0)
      return a.brandName.localeCompare(b.brandName) || a.model.localeCompare(b.model)
    })
  }, [items, query, brand, sort, pricedOnly])

  const filtering = Boolean(query || brand || pricedOnly)

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-black/5 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-6 py-3.5 sm:px-10">
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <span className="sr-only">Search the collection</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search brand, reference or year"
              className="h-10 w-full rounded-full border border-[#E5E7EB] bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20"
            />
          </label>

          <label className="min-w-0">
            <span className="sr-only">Filter by brand</span>
            <select
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              className="h-10 rounded-full border border-[#E5E7EB] bg-white px-4 text-sm outline-none transition focus:border-[color:var(--accent)]"
            >
              <option value="">All brands</option>
              {brands.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>

          <label className="min-w-0">
            <span className="sr-only">Sort</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              className="h-10 rounded-full border border-[#E5E7EB] bg-white px-4 text-sm outline-none transition focus:border-[color:var(--accent)]"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => setPricedOnly((on) => !on)}
            aria-pressed={pricedOnly}
            className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition ${
              pricedOnly
                ? 'border-transparent text-white'
                : 'border-[#E5E7EB] bg-white text-[#374151] hover:border-[#D1D5DB]'
            }`}
            style={pricedOnly ? { backgroundColor: 'var(--accent)' } : undefined}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            Priced only
          </button>

          <p className="ml-auto text-sm text-[#6B7280]">
            <span className="font-bold text-[#111827]">{shown.length}</span>
            {shown.length === 1 ? ' piece' : ' pieces'}
            {filtering && (
              <button
                type="button"
                onClick={() => { setQuery(''); setBrand(''); setPricedOnly(false) }}
                className="ml-3 inline-flex items-center gap-1 font-semibold hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Clear
              </button>
            )}
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-10 sm:px-10">
        {shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[#D1D5DB] px-6 py-20 text-center text-[#6B7280]">
            {filtering
              ? 'Nothing matches that. Try clearing the filters.'
              : 'Everything is currently reserved or sold. Please check back shortly.'}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((item) => (
              <ShopCard key={item.id} item={item} token={token} currency={currency} contactEmail={contactEmail} />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function ShopCard({ item, token, currency, contactEmail }: {
  item: ShopItem
  token: string
  currency: CurrencyCode
  contactEmail: string | null
}) {
  // "Not recorded" is not a fact about a watch, it is the absence of one. On an
  // internal screen it prompts somebody to go and fill it in; on a shop floor
  // it is just noise on every card.
  const condition = item.condition === 'UNKNOWN' ? null : CONDITION_LABELS[item.condition as Condition]
  const set = item.boxPapers === 'UNKNOWN' ? null : BOX_PAPERS_LABELS[item.boxPapers as BoxPapers]
  const facts = [item.year ? String(item.year) : null, condition, set].filter(Boolean) as string[]

  const subject = encodeURIComponent(`Enquiry: ${item.brandName} ${item.model}`)

  return (
    <li className="group flex flex-col">
      {/* One consistent treatment for every photograph: contained on white with
          room around it, so a bracelet shot and a packshot sit at the same
          visual weight instead of one filling the tile and the next floating. */}
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-[#F7F7F8] ring-1 ring-black/5 transition duration-300 group-hover:ring-black/10">
        {item.imageId ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/s/${token}/image/${item.imageId}`}
            alt={`${item.brandName} ${item.model}`}
            loading="lazy"
            className="h-full w-full object-contain p-6 transition duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-xs uppercase tracking-widest text-[#9CA3AF]">Photograph to follow</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col px-1 pt-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
          {item.brandName}
        </p>
        <h2 className="mt-1 text-[17px] font-bold leading-snug text-[#111827]">{item.model}</h2>
        {item.nickname && <p className="text-sm text-[#6B7280]">{item.nickname}</p>}

        {facts.length > 0 && (
          <p className="mt-2 text-xs text-[#6B7280]">{facts.join(' · ')}</p>
        )}

        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          {item.price === null ? (
            <span className="text-sm font-semibold text-[#6B7280]">Price on request</span>
          ) : (
            <span className="text-lg font-extrabold tabular-nums text-[#111827]">
              {formatCurrency(item.price, currency, { decimals: false })}
            </span>
          )}
          {contactEmail && (
            <a
              href={`mailto:${contactEmail}?subject=${subject}`}
              className="rounded-full border border-[#E5E7EB] px-3.5 py-1.5 text-xs font-bold text-[#374151] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
            >
              Enquire
            </a>
          )}
        </div>
      </div>
    </li>
  )
}
