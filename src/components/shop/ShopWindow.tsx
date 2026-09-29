'use client'
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
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
  { value: 'brand', label: 'Brand, A–Z' },
  { value: 'price-desc', label: 'Price, high to low' },
  { value: 'price-asc', label: 'Price, low to high' },
  { value: 'year-desc', label: 'Year, newest' },
]

const conditionOf = (item: ShopItem) =>
  item.condition === 'UNKNOWN' ? null : CONDITION_LABELS[item.condition as Condition]
const setOf = (item: ShopItem) =>
  item.boxPapers === 'UNKNOWN' ? null : BOX_PAPERS_LABELS[item.boxPapers as BoxPapers]

/** The full specification, skipping whatever is unknown. */
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
    ['Condition', conditionOf(item)],
    ['Accompanied by', setOf(item)],
  ]
  return rows.filter((row): row is [string, string] => Boolean(row[1]))
}

/**
 * The shop floor.
 *
 * Filtering happens here rather than on the server because the whole catalogue
 * is a few hundred rows at most and it is already on the page: a customer
 * narrowing to one house should not wait for a round trip, and this page has no
 * session to hang a server-side query state off.
 */
export function ShopWindow({ items, token, currency, contactEmail, hasLogo, shopName }: {
  items: ShopItem[]
  token: string
  currency: CurrencyCode
  contactEmail: string | null
  hasLogo: boolean
  shopName: string
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
        item.bracelet, item.year ? String(item.year) : null,
      ].filter(Boolean).some((field) => field!.toLowerCase().includes(needle))
    })

    // Unpriced pieces sort to the end of a price sort rather than counting as
    // zero, which would put a wall of "on request" at the top of a list
    // somebody asked to see cheapest first.
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
      {/*
        A rail, not a toolbar. Pill buttons and boxed selects are the visual
        language of an admin panel; here the controls sit on the page as text
        with a hairline under them, and only assert themselves when in use.
      */}
      <div className="sticky top-[72px] z-20 border-b border-[color:var(--hair)] bg-white/92 backdrop-blur">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-3 px-6 py-4 sm:px-10 md:flex-row md:items-center md:gap-x-8">
          <label className="relative w-full md:w-[240px] md:shrink-0 lg:w-[280px]">
            <span className="sr-only">Search the collection</span>
            <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--ink-mute)]" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search reference, dial, metal"
              className="h-9 w-full border-b border-[color:var(--hair)] bg-transparent pl-6 text-sm outline-none transition placeholder:text-[color:var(--ink-mute)] focus:border-[color:var(--accent)]"
            />
          </label>

          <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
            <Choice
              label="Brand" value={brand} onChange={setBrand}
              options={[{ value: '', label: 'All brands' }, ...brands.map((b) => ({ value: b, label: b }))]}
            />
            <Choice
              label="Order" value={sort} onChange={(v) => setSort(v as Sort)}
              options={SORTS}
            />

          {/* Reads as a control rather than a caption: a box that fills when
              it is on, which is what a person expects of a thing they can
              switch. Letterspaced caption text on its own looked like a label
              somebody had forgotten to attach to something. */}
            <button
              type="button"
              onClick={() => setPricedOnly((on) => !on)}
              aria-pressed={pricedOnly}
              className="group inline-flex items-center gap-2.5 text-sm text-[color:var(--ink-soft)] transition hover:text-[color:var(--ink)]"
            >
            <span
              className="flex h-4 w-4 items-center justify-center border transition"
              style={{
                borderColor: pricedOnly ? 'var(--accent)' : 'var(--ink-mute)',
                backgroundColor: pricedOnly ? 'var(--accent)' : 'transparent',
              }}
              aria-hidden
            >
              {pricedOnly && (
                <svg viewBox="0 0 10 8" className="h-2 w-2.5 fill-none stroke-white stroke-[2]">
                  <path d="M1 4l2.5 2.5L9 1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
              Priced only
            </button>
          </div>

          <p className="text-sm text-[color:var(--ink-mute)] md:ml-auto md:shrink-0">
            <span className="tabular-nums text-[color:var(--ink)]">{shown.length}</span>
            {shown.length === 1 ? ' piece available' : ' pieces available'}
            {filtering && (
              <button
                type="button"
                onClick={() => { setQuery(''); setBrand(''); setPricedOnly(false) }}
                className="ml-4 inline-flex items-center gap-1 hover:text-[color:var(--ink)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden /> Clear
              </button>
            )}
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-[1760px] px-6 py-12 sm:px-10">
        {shown.length === 0 ? (
          <div className="py-28 text-center">
            <p className="shop-serif text-[28px] text-[color:var(--ink-soft)]">
              {filtering
                ? 'Nothing here matches that.'
                : 'Every piece is currently reserved or sold.'}
            </p>
            {filtering ? (
              <button
                type="button"
                onClick={() => { setQuery(''); setBrand(''); setPricedOnly(false) }}
                className="shop-eyebrow mt-6 border-b pb-1 text-[color:var(--ink)]"
                style={{ borderColor: 'var(--accent)' }}
              >
                Show everything
              </button>
            ) : (
              <p className="mt-3 text-sm text-[color:var(--ink-mute)]">Please check back shortly.</p>
            )}
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-x-6 gap-y-12 sm:gap-x-8 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
          hasLogo={hasLogo}
          shopName={shopName}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  )
}

/** A select that reads as a line of text rather than as a form control. */
function Choice({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="group relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 cursor-pointer appearance-none border-b border-transparent bg-transparent pr-5 text-sm text-[color:var(--ink)] outline-none transition hover:border-[color:var(--hair)] focus:border-[color:var(--accent)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-0 text-[color:var(--ink-mute)]" aria-hidden>▾</span>
    </label>
  )
}

function ShopCard({ item, token, currency, onOpen }: {
  item: ShopItem
  token: string
  currency: CurrencyCode
  onOpen: () => void
}) {
  // A line of the things that decide whether it is the piece somebody wants.
  // Whatever is unknown is absent rather than labelled as unknown.
  const facts = [
    item.year ? String(item.year) : null,
    item.caseSizeMm ? `${item.caseSizeMm}mm` : null,
    item.caseMaterial,
    item.dial ? `${item.dial} dial` : null,
  ].filter(Boolean).slice(0, 3) as string[]

  const set = setOf(item)
  const condition = conditionOf(item)

  return (
    <li className="flex">
      <button
        type="button"
        onClick={onOpen}
        className="group flex h-full w-full flex-col text-left outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-8"
      >
        <div className="relative aspect-[4/5] w-full overflow-hidden bg-[color:var(--plinth)] transition-colors duration-500 group-hover:bg-[#f2f2ef]">
          {item.imageId ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`/s/${token}/image/${item.imageId}`}
              alt={`${item.brandName} ${item.model}`}
              loading="lazy"
              className="h-full w-full object-contain p-6 transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.06] sm:p-8"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="shop-eyebrow text-[color:var(--ink-mute)]">Photograph to follow</span>
            </div>
          )}

          {/* Provenance worth seeing before you click. A full set is the single
              fact that most changes what a piece is worth. */}
          {set === 'Full set' && (
            <span className="shop-eyebrow absolute left-4 top-4 bg-white/90 px-2.5 py-1 text-[color:var(--ink)] backdrop-blur">
              Full set
            </span>
          )}
          {item.imageIds.length > 1 && (
            <span className="absolute bottom-4 right-4 text-[11px] tabular-nums text-[color:var(--ink-mute)]">
              {item.imageIds.length} photographs
            </span>
          )}
        </div>

        {/*
          One block, with its own padding, so the rule beneath it sits the same
          distance from the text on every card. Spacing hung off the last
          element meant a piece with no specification line ended up with its
          rule tight against the reference, and one with them had a wider gap —
          a row of cards that each breathed differently.
        */}
        <div className="pb-5 pt-5">
          <p className="shop-eyebrow text-[color:var(--ink-mute)]">{item.brandName}</p>

          <h2 className="shop-serif shop-num mt-2.5 text-[21px] font-medium leading-[1.2] sm:text-[23px]">
            <span className="shop-underline">{item.nickname || item.model}</span>
          </h2>

          {item.nickname && (
            <p className="mt-1.5 text-[12.5px] text-[color:var(--ink-mute)]">Ref. {item.model}</p>
          )}

          {facts.length > 0 && (
            <p className="mt-3 text-[12.5px] leading-[1.55] text-[color:var(--ink-soft)]">
              {facts.join(' · ')}
            </p>
          )}
        </div>

        <div className="mt-auto flex items-baseline justify-between gap-4 border-t border-[color:var(--hair)] pt-4">
          {item.price === null ? (
            <span className="shop-serif text-[17px] italic text-[color:var(--ink-soft)]">Price on request</span>
          ) : (
            <span className="shop-serif shop-num text-[20px] font-medium">
              {formatCurrency(item.price, currency, { decimals: false })}
            </span>
          )}
          {condition && (
            <span className="text-[12px] text-[color:var(--ink-mute)]">{condition}</span>
          )}
        </div>
      </button>
    </li>
  )
}

/**
 * One piece, in full.
 *
 * A panel rather than a page: the customer is browsing, and sending them
 * somewhere else means a back button and a lost scroll position for every watch
 * they are curious about.
 */
function ProductView({ item, token, currency, contactEmail, hasLogo, shopName, onClose }: {
  item: ShopItem
  token: string
  currency: CurrencyCode
  contactEmail: string | null
  hasLogo: boolean
  shopName: string
  onClose: () => void
}) {
  const images = item.imageIds.length > 0 ? item.imageIds : item.imageId ? [item.imageId] : []
  const [index, setIndex] = useState(0)
  const spec = specOf(item)

  useEffect(() => {
    const count = Math.max(images.length, 1)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') setIndex((i) => (i + 1) % count)
      if (event.key === 'ArrowLeft') setIndex((i) => (i - 1 + count) % count)
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
    `Hello,\n\nI would like to enquire about the ${item.brandName} ${item.nickname || item.model}`
    + `${item.year ? ` (${item.year})` : ''}, reference ${item.model}.\n\nThank you.`,
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#14161a]/45 backdrop-blur-sm sm:p-8">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${item.brandName} ${item.model}`}
        className="relative w-full max-w-6xl bg-white shadow-[0_40px_120px_-20px_rgba(20,22,26,0.4)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center bg-white/80 text-[color:var(--ink-soft)] backdrop-blur transition hover:text-[color:var(--ink)]"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="grid md:grid-cols-[1.15fr_1fr]">
          <div className="bg-[color:var(--plinth)]">
            <div className="relative aspect-square">
              {images.length > 0 ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/s/${token}/image/${images[index]}`}
                  alt={`${item.brandName} ${item.model}`}
                  className="h-full w-full object-contain p-14"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span className="shop-eyebrow text-[color:var(--ink-mute)]">Photograph to follow</span>
                </div>
              )}

              {images.length > 1 && (
                <>
                  <button
                    type="button" aria-label="Previous photograph"
                    onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
                    className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center bg-white/85 backdrop-blur transition hover:bg-white"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button" aria-label="Next photograph"
                    onClick={() => setIndex((i) => (i + 1) % images.length)}
                    className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center bg-white/85 backdrop-blur transition hover:bg-white"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>

            {images.length > 1 && (
              <div className="flex gap-3 overflow-x-auto px-6 pb-6">
                {images.map((id, i) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`Photograph ${i + 1}`}
                    aria-current={i === index}
                    className="h-16 w-16 shrink-0 overflow-hidden bg-white transition"
                    style={{ outline: i === index ? '1px solid var(--accent)' : '1px solid var(--hair)' }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/s/${token}/image/${id}`} alt="" className="h-full w-full object-contain p-2" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col p-8 sm:p-12">
            {hasLogo && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`/s/${token}/logo`}
                alt={shopName}
                className="mb-7 h-8 w-auto max-w-[150px] object-contain"
              />
            )}
            <p className="shop-eyebrow text-[color:var(--ink-mute)]">{item.brandName}</p>
            {/* Lining figures on the heading too: plenty of these names are a
                reference number, and old-style digits make one look mistyped. */}
            <h2 className="shop-serif shop-num mt-3 text-[34px] font-medium leading-[1.08] sm:text-[42px]">
              {item.nickname || item.model}
            </h2>
            {/* Only when it says something the heading did not. */}
            {item.nickname && (
              <p className="mt-2 text-sm text-[color:var(--ink-mute)]">Reference {item.model}</p>
            )}

            <p className="mt-7 border-t border-[color:var(--hair)] pt-7">
              {item.price === null ? (
                <span className="shop-serif text-[24px] italic text-[color:var(--ink-soft)]">Price on request</span>
              ) : (
                <span className="shop-serif shop-num text-[34px] font-medium">
                  {formatCurrency(item.price, currency, { decimals: false })}
                </span>
              )}
            </p>

            {item.description && (
              <p className="mt-6 text-[15px] leading-[1.75] text-[color:var(--ink-soft)]">{item.description}</p>
            )}

            {spec.length > 0 && (
              <dl className="mt-8 border-t border-[color:var(--hair)]">
                {spec.map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between gap-6 border-b border-[color:var(--hair)] py-3"
                  >
                    <dt className="text-[13px] text-[color:var(--ink-mute)]">{label}</dt>
                    <dd className="text-[14px] font-medium text-[color:var(--ink)]">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="mt-auto pt-10">
              {contactEmail && (
                <a
                  href={`mailto:${contactEmail}?subject=${subject}&body=${body}`}
                  className="group inline-flex h-14 w-full items-center justify-center gap-3 px-8 text-[13px] font-bold uppercase tracking-[0.16em] text-white transition hover:brightness-110"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  Enquire
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                className="mt-4 w-full text-[13px] text-[color:var(--ink-mute)] underline-offset-4 transition hover:text-[color:var(--ink)] hover:underline"
              >
                Back to the collection
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
