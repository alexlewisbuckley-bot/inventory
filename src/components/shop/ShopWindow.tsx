'use client'
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react'
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
  imageIds: string[]
  caseSizeMm: number | null
  caseMaterial: string | null
  dial: string | null
  bracelet: string | null
  movement: string | null
  waterResistanceM: number | null
  description: string | null
}

type Sort = 'brand' | 'price-desc' | 'price-asc' | 'year-desc'

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'brand', label: 'Brand A–Z' },
  { value: 'price-desc', label: 'Price, high to low' },
  { value: 'price-asc', label: 'Price, low to high' },
  { value: 'year-desc', label: 'Newest first' },
]

/** The specification, as label/value pairs, skipping whatever is unknown. */
function specOf(item: ShopItem): Array<[string, string]> {
  const rows: Array<[string, string | null]> = [
    ['Reference', item.model],
    ['Year', item.year ? String(item.year) : null],
    ['Case', item.caseSizeMm ? `${item.caseSizeMm}mm` : null],
    ['Material', item.caseMaterial],
    ['Dial', item.dial],
    ['Bracelet', item.bracelet],
    ['Movement', item.movement],
    ['Water resistance', item.waterResistanceM ? `${item.waterResistanceM}m` : null],
    ['Condition', item.condition === 'UNKNOWN' ? null : CONDITION_LABELS[item.condition as Condition]],
    ['Box & papers', item.boxPapers === 'UNKNOWN' ? null : BOX_PAPERS_LABELS[item.boxPapers as BoxPapers]],
  ]
  return rows.filter((row): row is [string, string] => Boolean(row[1]))
}

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
  const [viewing, setViewing] = useState<ShopItem | null>(null)

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
      return [
        item.brandName, item.model, item.nickname, item.dial, item.caseMaterial,
        item.year ? String(item.year) : null,
      ].filter(Boolean).some((field) => field!.toLowerCase().includes(needle))
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
      <div className="sticky top-[72px] z-20 border-b border-black/[0.06] bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-6 py-3.5 sm:px-10">
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <span className="sr-only">Search the collection</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search reference, model or dial"
              className="h-10 w-full rounded-full border border-[#E5E7EB] bg-white pl-10 pr-3 text-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent)]/10"
            />
          </label>

          <label>
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

          <label>
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
              pricedOnly ? 'border-transparent text-white' : 'border-[#E5E7EB] bg-white text-[#374151] hover:border-[#D1D5DB]'
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
              <ShopCard key={item.id} item={item} token={token} currency={currency} onOpen={() => setViewing(item)} />
            ))}
          </ul>
        )}
      </div>

      {viewing && (
        <ProductView
          item={viewing}
          token={token}
          currency={currency}
          contactEmail={contactEmail}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  )
}

function ShopCard({ item, token, currency, onOpen }: {
  item: ShopItem
  token: string
  currency: CurrencyCode
  onOpen: () => void
}) {
  // Two or three facts, not the whole specification: a card is a reason to
  // look closer, and a grid of ten-line spec blocks is a spreadsheet.
  const facts = [
    item.year ? String(item.year) : null,
    item.caseSizeMm ? `${item.caseSizeMm}mm` : null,
    item.dial,
    item.condition === 'UNKNOWN' ? null : CONDITION_LABELS[item.condition as Condition],
  ].filter(Boolean).slice(0, 3) as string[]

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full flex-col text-left outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--accent)]/20"
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-[#F6F6F7] ring-1 ring-black/[0.04] transition duration-300 group-hover:ring-black/10">
          {item.imageId ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`/s/${token}/image/${item.imageId}`}
              alt={`${item.brandName} ${item.model}`}
              loading="lazy"
              className="h-full w-full object-contain p-7 transition duration-500 group-hover:scale-[1.05]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-[11px] uppercase tracking-[0.18em] text-[#B6BCC6]">Photograph to follow</span>
            </div>
          )}

          {item.imageIds.length > 1 && (
            <span className="absolute right-3 top-3 rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-bold text-[#4B5563] backdrop-blur">
              {item.imageIds.length}
            </span>
          )}

          {/* The prompt to open it, held back until the card is hovered so the
              grid stays quiet when nobody is pointing at anything. */}
          <span className="pointer-events-none absolute inset-x-3 bottom-3 flex translate-y-2 items-center justify-center gap-1.5 rounded-full bg-[#111827]/90 py-2 text-xs font-bold text-white opacity-0 backdrop-blur transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            View details <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>

        <div className="flex flex-1 flex-col px-1 pt-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--accent)' }}>
            {item.brandName}
          </p>
          <h2 className="mt-1 text-[17px] font-bold leading-snug text-[#111827]">
            {item.nickname || item.model}
          </h2>
          {item.nickname && <p className="text-sm text-[#6B7280]">{item.model}</p>}
          {facts.length > 0 && <p className="mt-2 text-xs text-[#6B7280]">{facts.join(' · ')}</p>}
          <p className="mt-3 pt-1">
            {item.price === null ? (
              <span className="text-sm font-semibold text-[#6B7280]">Price on request</span>
            ) : (
              <span className="text-lg font-extrabold tabular-nums text-[#111827]">
                {formatCurrency(item.price, currency, { decimals: false })}
              </span>
            )}
          </p>
        </div>
      </button>
    </li>
  )
}

/**
 * One piece, in full.
 *
 * A panel rather than a page: the customer is browsing a grid, and sending
 * them somewhere else means a back button and a lost scroll position for every
 * watch they are curious about.
 */
function ProductView({ item, token, currency, contactEmail, onClose }: {
  item: ShopItem
  token: string
  currency: CurrencyCode
  contactEmail: string | null
  onClose: () => void
}) {
  const images = item.imageIds.length > 0 ? item.imageIds : item.imageId ? [item.imageId] : []
  const [index, setIndex] = useState(0)
  const spec = specOf(item)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') setIndex((i) => (i + 1) % Math.max(images.length, 1))
      if (event.key === 'ArrowLeft') setIndex((i) => (i - 1 + Math.max(images.length, 1)) % Math.max(images.length, 1))
    }
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose, images.length])

  const subject = encodeURIComponent(`Enquiry: ${item.brandName} ${item.model}`)
  const body = encodeURIComponent(
    `Hello,\n\nI would like to enquire about the ${item.brandName} ${item.model}`
    + `${item.year ? ` (${item.year})` : ''}.\n\nThank you.`,
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#111827]/50 p-0 backdrop-blur-sm sm:p-6">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${item.brandName} ${item.model}`}
        className="relative my-0 w-full max-w-5xl overflow-hidden bg-white shadow-2xl sm:my-6 sm:rounded-3xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[#374151] shadow-sm backdrop-blur transition hover:text-[#111827]"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="grid gap-0 md:grid-cols-2">
          <div className="bg-[#F6F6F7]">
            <div className="relative aspect-square">
              {images.length > 0 ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/s/${token}/image/${images[index]}`}
                  alt={`${item.brandName} ${item.model}`}
                  className="h-full w-full object-contain p-10"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span className="text-xs uppercase tracking-[0.18em] text-[#B6BCC6]">Photograph to follow</span>
                </div>
              )}

              {images.length > 1 && (
                <>
                  <button
                    type="button" aria-label="Previous photograph"
                    onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
                    className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button" aria-label="Next photograph"
                    onClick={() => setIndex((i) => (i + 1) % images.length)}
                    className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>

            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto px-5 pb-5">
                {images.map((id, i) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`Photograph ${i + 1}`}
                    aria-current={i === index}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-white ring-1 transition ${
                      i === index ? 'ring-2' : 'ring-black/5 hover:ring-black/20'
                    }`}
                    style={i === index ? { ['--tw-ring-color' as string]: 'var(--accent)' } : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/s/${token}/image/${id}`} alt="" className="h-full w-full object-contain p-1.5" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col p-7 sm:p-9">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--accent)' }}>
              {item.brandName}
            </p>
            <h2 className="mt-1.5 text-2xl font-extrabold leading-tight tracking-tight text-[#111827] sm:text-[28px]">
              {item.nickname || item.model}
            </h2>
            {item.nickname && <p className="mt-1 text-[#6B7280]">Reference {item.model}</p>}

            <p className="mt-5 text-2xl font-extrabold tabular-nums text-[#111827]">
              {item.price === null
                ? <span className="text-lg font-semibold text-[#6B7280]">Price on request</span>
                : formatCurrency(item.price, currency, { decimals: false })}
            </p>

            {item.description && (
              <p className="mt-5 text-[15px] leading-relaxed text-[#374151]">{item.description}</p>
            )}

            {spec.length > 0 && (
              <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-black/[0.07] pt-6">
                {spec.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] uppercase tracking-wider text-[#9CA3AF]">{label}</dt>
                    <dd className="mt-0.5 text-sm font-semibold text-[#111827]">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="mt-auto flex flex-wrap gap-3 pt-8">
              {contactEmail && (
                <a
                  href={`mailto:${contactEmail}?subject=${subject}&body=${body}`}
                  className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold text-white transition hover:brightness-110"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  Enquire about this piece <ArrowRight className="h-4 w-4" />
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-12 items-center justify-center rounded-full border border-[#E5E7EB] px-6 text-sm font-bold text-[#374151] transition hover:border-[#D1D5DB]"
              >
                Keep looking
              </button>
            </div>

            <p className="mt-4 text-xs text-[#9CA3AF]">
              Availability is live. Shown in {currency}.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
