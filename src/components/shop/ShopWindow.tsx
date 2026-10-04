'use client'
import { useEffect, useMemo, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { submitEnquiryAction } from '@/app/actions/enquiries'
import type { ActionState } from '@/app/actions/auth'
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
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
export function ShopWindow({
  items, token, currency, contactEmail, hasLogo, shopName, embedded = false,
}: {
  items: ShopItem[]
  token: string
  currency: CurrencyCode
  contactEmail: string | null
  hasLogo: boolean
  shopName: string
  /** Inside somebody else's page, where this is a block and not a page. */
  embedded?: boolean
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
      {/*
        Pinned under the header only from lg, where it is one line. On a
        phone it stacks into three, and pinning that as well left the header
        and the rail covering the top third of the screen for the whole
        scroll — so below lg it stays at the top of the page and scrolls away.

        Never pinned in an embed, at any width: the frame is the height of its
        contents and so never scrolls, which leaves sticking with nothing to do
        except hold the rail 72px down over the first row of watches.
      */}
      <div className={embedded
        ? 'border-b border-[color:var(--hair)] bg-white'
        : 'border-b border-[color:var(--hair)] bg-white lg:sticky lg:top-[72px] lg:z-20 lg:bg-white/92 lg:backdrop-blur'}>
        <div className="mx-auto flex max-w-[1760px] flex-col gap-2 px-6 py-3 sm:px-10 md:flex-row md:items-center md:gap-x-8 md:py-4">
          <label className="relative w-full md:w-[240px] md:shrink-0 lg:w-[280px]">
            <span className="sr-only">Search the collection</span>
            <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--ink-mute)]" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search reference, dial, metal"
              // 16px on a phone: iOS zooms the page into any field set
              // smaller the moment it is tapped, and leaves it zoomed.
              className="h-10 w-full rounded-none border-b border-[color:var(--hair)] bg-transparent pl-6 text-base outline-none transition placeholder:text-[color:var(--ink-mute)] focus:border-[color:var(--accent)] md:h-9 md:text-sm"
            />
          </label>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 md:gap-x-7">
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

      <div className="mx-auto max-w-[1760px] px-6 py-8 sm:px-10 md:py-12">
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
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-8 sm:gap-y-12 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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

/**
 * A select that reads as a line of text rather than as a form control.
 *
 * The native control is laid over the top at full size and made invisible,
 * and the text beside the arrow is ours. That is the only way to have both:
 * a styled `appearance-none` select is sized by its *longest* option, so the
 * chevron parked at its right edge sat a brand name's width away from the
 * words actually on screen — "All brands" with the arrow somewhere off near
 * where "Patek Philippe" would have ended. Drawing the current label
 * ourselves means the control is exactly as wide as what it says, while the
 * select underneath keeps the platform's own menu, keyboard handling and
 * touch behaviour.
 */
function Choice({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  const current = options.find((option) => option.value === value)?.label ?? ''

  return (
    <label className="relative inline-flex h-9 cursor-pointer items-center gap-2 border-b border-transparent transition hover:border-[color:var(--hair)] focus-within:border-[color:var(--accent)]">
      <span className="sr-only">{label}</span>
      <span aria-hidden className="whitespace-nowrap text-sm text-[color:var(--ink)]">{current}</span>
      {/* In the shop's own colour, and a hair below the text's centre line,
          where a chevron reads as pointing at the words rather than floating
          beside them. */}
      <ChevronDown
        aria-hidden
        className="mt-px h-3.5 w-3.5 shrink-0"
        strokeWidth={2}
        style={{ color: 'var(--brand)' }}
      />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // Invisible, but 16px all the same: the size is what iOS checks
        // before zooming the page in on a tap.
        className="absolute inset-0 h-full w-full cursor-pointer text-base opacity-0"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
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
      className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.13em]"
      /*
       * The contrast between the two states does the work, not the marks
       * themselves. A watch with neither box nor papers is most of the
       * trade; two heavy crosses on its card read as two things wrong with
       * it. Absent is drawn as a hairline in the lightest grey on the page
       * and simply recedes, while present is picked out in the reseller's
       * accent — so a full set is what catches the eye across a grid.
       */
      style={{ color: has ? 'var(--ink-soft)' : 'var(--ink-mute)' }}
    >
      <svg
        viewBox="0 0 12 12"
        className="h-[10px] w-[10px] shrink-0 fill-none"
        style={{
          stroke: has ? 'var(--accent)' : 'var(--ink-mute)',
          strokeWidth: has ? 1.5 : 1.1,
        }}
        aria-hidden
      >
        {has ? (
          <path d="M1.5 6.2l3 3L10.5 2.8" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M2.8 2.8l6.4 6.4M9.2 2.8l-6.4 6.4" strokeLinecap="round" />
        )}
      </svg>
      {label}
      <span className="sr-only">{has ? ' included' : ' not included'}</span>
    </span>
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
              className="h-full w-full object-contain p-4 transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.06] sm:p-8"
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
          The piece and its price carry the card; everything else is there to
          confirm a decision those two have already prompted.

          Spacing on a scale rather than by eye: 8px inside the identity block
          (brand, name, figure — three lines that are one thought), 20px to
          break to the secondary facts, 8px inside those, and 24px of clear
          air before the action. Gaps chosen line by line are what made the
          last version feel arbitrary.

          The name no longer carries a hover underline. It was a rule drawn at
          the foot of its line box, which put it within a few pixels of the
          price the moment anybody moved a cursor over the card — and it was
          the third thing on the card announcing the same hover, after the
          photograph lifting and the button filling. Two is already plenty.
        */}
        <div className="flex flex-1 flex-col pt-4 sm:pt-6">
          <p className="shop-eyebrow truncate text-[color:var(--ink-mute)]">{item.brandName}</p>

          <h2 className="shop-serif shop-num mt-1.5 text-[20px] font-medium leading-[1.15] sm:mt-2 sm:text-[26px]">
            {item.nickname || item.model}
          </h2>

          {/* leading-[1.1] rather than none: a currency prefix and lining
              figures both sit tall, and a zero line-height clips them. */}
          {item.price === null ? (
            <p className="shop-serif mt-1.5 text-[16px] italic leading-[1.1] text-[color:var(--ink-soft)] sm:mt-2 sm:text-[18px]">
              Price on request
            </p>
          ) : (
            <p className="shop-serif shop-num mt-1.5 text-[18px] font-medium leading-[1.1] sm:mt-2 sm:text-[20px]">
              {formatCurrency(item.price, currency, { decimals: false })}
            </p>
          )}

          {provenance && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 sm:mt-5">
              <Provenance label="Box" has={provenance.box} />
              <Provenance label="Papers" has={provenance.papers} />
            </div>
          )}

          {/* One per line, and unlabelled. A reference and a year are two
              different questions and a middle dot made them look like one
              field; "Ref." in front of a Rolex reference is a caption on a
              thing that captions itself. 4px between them because they are
              still a pair — the 8px above sets them apart from what came
              with the watch, and that difference is what makes them read as
              a group rather than as a list.

              A piece with no model name is headed by its reference, so it is
              not repeated here. */}
          {(item.nickname || item.year) && (
            <div className="mt-2 flex flex-col gap-1 text-[11.5px] leading-[1.3] text-[color:var(--ink-mute)]">
              {item.nickname && (
                <p className="shop-num truncate">
                  <span className="sr-only">Reference </span>{item.model}
                </p>
              )}
              {item.year && (
                <p className="shop-num">
                  <span className="sr-only">Year </span>{item.year}
                </p>
              )}
            </div>
          )}

          {/* Not on a phone. The whole card is the target, so on a column
              150px wide the button was a 64px repeat of what a tap anywhere
              already does, on every card, down the whole page. */}
          <span className="mt-auto hidden pt-6 sm:block">
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

            {/*
              The specification stands down while somebody is writing.
              Ten rows of it between the button they pressed and the fields
              they pressed it to reach means scrolling past the answer to a
              question they have already stopped asking. The heading and the
              price stay, so it is still clear which watch this is about.
            */}
            {!enquiring && item.description && (
              <p className="mt-5 text-[14px] leading-[1.7] text-[color:var(--ink-soft)]">{item.description}</p>
            )}

            {/*
              Two up. A single column of nine rows made the panel taller than
              most screens, and a specification is a reference table rather
              than prose — nothing is lost by reading it in two passes down
              instead of one long one. It falls back to one column on a phone,
              where two would leave no room for the values.
            */}
            {!enquiring && spec.length > 0 && (
              <dl className="mt-6 grid border-t border-[color:var(--hair)] sm:grid-cols-2 sm:gap-x-9">
                {spec.map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between gap-4 border-b border-[color:var(--hair)] py-2.5"
                  >
                    <dt className="shrink-0 text-[12.5px] text-[color:var(--ink-mute)]">{label}</dt>
                    <dd className="text-right text-[13.5px] font-medium text-[color:var(--ink)]">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className={enquiring ? 'pt-7' : 'mt-auto pt-8'}>
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

      {/* The specification steps aside for this, so the form says what it is
          rather than appearing where a table used to be. */}
      <p className="shop-eyebrow text-[color:var(--ink-mute)]">Enquire about this piece</p>
      <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--ink-soft)]">
        Leave your details and we will come back to you.
      </p>

      {state.message && (
        <p role="alert" className="mt-4 text-[12.5px] text-[#9b2c2c]">{state.message}</p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
