'use client'
import { useEffect, useMemo, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { submitEnquiryAction } from '@/app/actions/enquiries'
import type { ActionState } from '@/app/actions/auth'
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

/**
 * What came with it, as two facts rather than one phrase.
 *
 * "Full set" reads as a single claim; a buyer is weighing two separate ones,
 * and "box only" tells them nothing about papers unless they already know the
 * vocabulary. Ticked and unticked side by side answers both at a glance.
 * Unrecorded stays absent — an unticked box is a statement that it is missing.
 */
function provenanceOf(item: ShopItem): { box: boolean; papers: boolean } | null {
  switch (item.boxPapers as BoxPapers) {
    case 'FULL_SET': return { box: true, papers: true }
    case 'BOX_ONLY': return { box: true, papers: false }
    case 'PAPERS_ONLY': return { box: false, papers: true }
    case 'WATCH_ONLY': return { box: false, papers: false }
    default: return null
  }
}

function Provenance({ label, has }: { label: string; has: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 border px-2 py-[3px] text-[10px] uppercase tracking-[0.14em]"
      style={{
        borderColor: has ? 'var(--accent)' : 'var(--hair)',
        color: has ? 'var(--ink)' : 'var(--ink-mute)',
      }}
    >
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 shrink-0 fill-none stroke-current stroke-[1.6]" aria-hidden>
        {has ? (
          <path d="M1 5l2.6 2.6L9 1.8" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M2 2l6 6M8 2l-6 6" strokeLinecap="round" />
        )}
      </svg>
      {label}
      <span className="sr-only">{has ? ' included' : ' not included'}</span>
    </span>
  )
}

/** One fact, termed. Aligned so the values line up down a column of cards. */
function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-[74px] shrink-0 text-[color:var(--ink-mute)]">{term}</dt>
      <dd className="shop-num truncate text-[color:var(--ink-soft)]">{value}</dd>
    </div>
  )
}

function ShopCard({ item, token, currency, onOpen }: {
  item: ShopItem
  token: string
  currency: CurrencyCode
  onOpen: () => void
}) {
  const provenance = provenanceOf(item)

  return (
    <li className="flex">
      {/*
        One target for the whole card, so the call to action is a span rather
        than a button: a button inside a button is invalid, and splitting the
        card into two hit areas would mean the photograph and the words did
        different things.
      */}
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
              alt={`${item.brandName} ${item.nickname || item.model}`}
              loading="lazy"
              className="h-full w-full object-contain p-6 transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.06] sm:p-8"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="shop-eyebrow text-[color:var(--ink-mute)]">Photograph to follow</span>
            </div>
          )}

          {item.imageIds.length > 1 && (
            <span className="absolute bottom-4 right-4 text-[11px] tabular-nums text-[color:var(--ink-mute)]">
              {item.imageIds.length} photographs
            </span>
          )}
        </div>

        {/*
          Brand, then the piece, then what came with it, then the numbers that
          identify it — read in the order somebody shopping actually asks. The
          price sits on the brand line: it is the other thing they are scanning
          for, and pinning it to the top keeps it in the same place on every
          card whether or not the specification beneath runs long.
        */}
        <div className="flex flex-1 flex-col pt-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="shop-eyebrow truncate text-[color:var(--ink-mute)]">{item.brandName}</p>
            {item.price === null ? (
              <span className="shop-serif shrink-0 text-[15px] italic leading-none text-[color:var(--ink-soft)]">
                On request
              </span>
            ) : (
              <span className="shop-serif shop-num shrink-0 text-[18px] font-medium leading-none">
                {formatCurrency(item.price, currency, { decimals: false })}
              </span>
            )}
          </div>

          <h2 className="shop-serif shop-num mt-2 text-[21px] font-medium leading-[1.2] sm:text-[23px]">
            <span className="shop-underline">{item.nickname || item.model}</span>
          </h2>

          {provenance && (
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              <Provenance label="Box" has={provenance.box} />
              <Provenance label="Papers" has={provenance.papers} />
            </div>
          )}

          {/* A piece with no model name is headed by its reference, and
              printing it again under "Reference" is the same string twice. */}
          <dl className="mt-4 flex flex-col gap-1.5 text-[12.5px] leading-[1.5]">
            {item.nickname && <Fact term="Reference" value={item.model} />}
            {item.year && <Fact term="Year" value={String(item.year)} />}
          </dl>

          {/* Pinned to the foot so the rule and the action sit at the same
              height across a row, however much specification each card has. */}
          <span className="mt-auto pt-5">
            <span className="shop-cta flex h-10 w-full items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]">
              Find out more
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
            </span>
          </span>
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
  const [enquiring, setEnquiring] = useState(false)
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#14161a]/45 backdrop-blur-sm sm:p-8">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${item.brandName} ${item.model}`}
        className="relative w-full max-w-5xl bg-white shadow-[0_40px_120px_-20px_rgba(20,22,26,0.4)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center bg-white/80 text-[color:var(--ink-soft)] backdrop-blur transition hover:text-[color:var(--ink)]"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="grid md:grid-cols-[1fr_1fr]">
          <div className="bg-[color:var(--plinth)]">
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

          <div className="flex flex-col p-7 sm:p-9">
            {hasLogo && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`/s/${token}/logo`}
                alt={shopName}
                /*
                 * self-start, because this sits in a flex column: without it
                 * the image stretches to the full width of the panel and
                 * object-contain centres the artwork inside that box, so the
                 * mark floated in the middle while every line under it started
                 * at the left margin.
                 */
                className="mb-5 h-7 w-auto max-w-[130px] self-start object-contain object-left"
              />
            )}
            <p className="shop-eyebrow text-[color:var(--ink-mute)]">{item.brandName}</p>
            {/* Lining figures on the heading too: plenty of these names are a
                reference number, and old-style digits make one look mistyped. */}
            <h2 className="shop-serif shop-num mt-2.5 text-[28px] font-medium leading-[1.1] sm:text-[34px]">
              {item.nickname || item.model}
            </h2>
            {/* Only when it says something the heading did not. */}
            {item.nickname && (
              <p className="mt-2 text-sm text-[color:var(--ink-mute)]">Reference {item.model}</p>
            )}

            <p className="mt-5 border-t border-[color:var(--hair)] pt-5">
              {item.price === null ? (
                <span className="shop-serif text-[20px] italic text-[color:var(--ink-soft)]">Price on request</span>
              ) : (
                <span className="shop-serif shop-num text-[28px] font-medium">
                  {formatCurrency(item.price, currency, { decimals: false })}
                </span>
              )}
            </p>

            {item.description && (
              <p className="mt-5 text-[14px] leading-[1.7] text-[color:var(--ink-soft)]">{item.description}</p>
            )}

            {spec.length > 0 && (
              <dl className="mt-6 border-t border-[color:var(--hair)]">
                {spec.map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between gap-6 border-b border-[color:var(--hair)] py-2.5"
                  >
                    <dt className="text-[12.5px] text-[color:var(--ink-mute)]">{label}</dt>
                    <dd className="text-[13.5px] font-medium text-[color:var(--ink)]">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="mt-auto pt-8">
              {/*
                A form, not a mailto. A mail link needs a client configured on
                the customer's machine, leaves nothing behind here when it is
                not, and only appeared at all when the reseller had filled in a
                contact address — so the reseller who had not had no way for
                anybody to enquire at all.
              */}
              {enquiring ? (
                <EnquiryForm
                  token={token}
                  watchId={item.id}
                  onCancel={() => setEnquiring(false)}
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setEnquiring(true)}
                    className="group inline-flex h-13 w-full items-center justify-center gap-3 px-8 py-4 text-[12px] font-bold uppercase tracking-[0.16em] text-white transition hover:brightness-110"
                    style={{ backgroundColor: 'var(--brand)' }}
                  >
                    Enquire now
                    <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-3.5 w-full text-[12.5px] text-[color:var(--ink-mute)] underline-offset-4 transition hover:text-[color:var(--ink)] hover:underline"
                  >
                    Back to the collection
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The enquiry.
 *
 * Four fields and nothing clever. A customer who has decided to ask about a
 * watch should not meet a wizard; the only required things are a name and a
 * way to reply.
 *
 * On success the form is replaced by the acknowledgement rather than clearing
 * itself, because a form that empties looks like it lost what you typed.
 */
function EnquiryForm({ token, watchId, onCancel }: {
  token: string
  watchId: string
  onCancel: () => void
}) {
  const [state, action] = useFormState(submitEnquiryAction, { ok: false } as ActionState)

  if (state.ok) {
    return (
      <div className="border-t border-[color:var(--hair)] pt-6 text-center">
        <p className="shop-serif text-[22px] leading-snug">Thank you.</p>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[color:var(--ink-soft)]">
          {state.message}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-5 text-[12.5px] text-[color:var(--ink-mute)] underline-offset-4 hover:text-[color:var(--ink)] hover:underline"
        >
          Back to the collection
        </button>
      </div>
    )
  }

  return (
    <form action={action} className="border-t border-[color:var(--hair)] pt-6">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="watchId" value={watchId} />

      {state.message && (
        <p role="alert" className="mb-4 text-[12.5px] text-[#9b2c2c]">{state.message}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label="Your name" required error={state.errors?.name} />
        <Field name="email" label="Email" type="email" required error={state.errors?.email} />
      </div>
      <div className="mt-3">
        <Field name="phone" label="Phone (optional)" error={state.errors?.phone} />
      </div>
      <label className="mt-3 block">
        <span className="shop-eyebrow text-[color:var(--ink-mute)]">Message</span>
        <textarea
          name="message"
          rows={3}
          placeholder="Anything you would like to know."
          className="mt-1.5 w-full border border-[color:var(--hair)] bg-white px-3 py-2 text-[13.5px] outline-none transition focus:border-[color:var(--accent)]"
        />
      </label>

      <SendButton />
      <button
        type="button"
        onClick={onCancel}
        className="mt-3 w-full text-[12.5px] text-[color:var(--ink-mute)] underline-offset-4 hover:text-[color:var(--ink)] hover:underline"
      >
        Cancel
      </button>
    </form>
  )
}

function Field({ name, label, type = 'text', required, error }: {
  name: string
  label: string
  type?: string
  required?: boolean
  error?: string
}) {
  return (
    <label className="block">
      <span className="shop-eyebrow text-[color:var(--ink-mute)]">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        className="mt-1.5 h-10 w-full border border-[color:var(--hair)] bg-white px-3 text-[13.5px] outline-none transition focus:border-[color:var(--accent)]"
      />
      {error && <span className="mt-1 block text-[12px] text-[#9b2c2c]">{error}</span>}
    </label>
  )
}

function SendButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-5 w-full px-8 py-4 text-[12px] font-bold uppercase tracking-[0.16em] text-white transition hover:brightness-110 disabled:opacity-60"
      style={{ backgroundColor: 'var(--brand)' }}
    >
      {pending ? 'Sending…' : 'Send enquiry'}
    </button>
  )
}
