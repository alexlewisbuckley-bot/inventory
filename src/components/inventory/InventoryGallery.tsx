'use client'
import Link from 'next/link'
import { Camera, Handshake } from 'lucide-react'
import { cn } from '@/lib/cn'
import { StatusDot, UnpricedChip, ZoomButton, useCurrency } from '@/components/ui'
import { CheckDot } from '@/components/compliance/CheckLight'
import { CHECK_TONE_LABELS, watchChecks } from '@/lib/checks'
import { PRODUCT_TYPE_LABELS, type WatchStatus } from '@/lib/enums'
import type { WatchListItem } from '@/server/repositories/watch-repository'

/**
 * Stock as photographs.
 *
 * The table answers "what do we hold and what is it worth"; this answers
 * "which one is that" — the question somebody asks with a customer on the
 * phone, and the one a grid of reference numbers is worst at. Same rows, same
 * filters, same selection: only the presentation differs, which is why it
 * lives inside the list rather than on a route of its own.
 */
export function InventoryGallery({
  items, selectable, isSelected, onToggle, canSeeCost, canSeeRevenue, href,
  showTrade = false,
}: {
  items: WatchListItem[]
  selectable: boolean
  isSelected: (id: string) => boolean
  onToggle: (id: string) => void
  canSeeCost: boolean
  canSeeRevenue: boolean
  /** Where a card goes — the drawer, keeping the list behind it. */
  href: (id: string) => string
  /** Show the trade shot of each watch rather than the published one. */
  showTrade?: boolean
}) {
  const { money } = useCurrency()

  return (
    <ul className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((watch) => {
        const sold = watch.status === 'SOLD'
        const checks = watchChecks({
          vatNo: watch.supplierVatNo,
          entityType: watch.supplierEntityType,
          vatCheckStatus: watch.supplierVatCheckStatus,
          vatCheckedAt: watch.supplierVatCheckedAt,
          directorName: watch.supplierDirectorName,
          idCheckStatus: watch.supplierIdCheckStatus,
          idCheckedAt: watch.supplierIdCheckedAt,
          idDocumentExpiresOn: watch.supplierIdDocumentExpiresOn,
          serial: watch.serial,
          registerCheckStatus: watch.registerCheckStatus,
          registerCheckedAt: watch.registerCheckedAt,
        })
        const selected = isSelected(watch.id)

        return (
          <li key={watch.id} className="relative">
            {selectable && (
              // Outside the link, or selecting a card would open it.
              <label className="absolute left-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm bg-surface-raised/90 shadow-sm">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggle(watch.id)}
                  aria-label={`Select stock ${watch.stockNo}`}
                  className="h-4 w-4 rounded-xs accent-teal-500"
                />
              </label>
            )}

            <Link
              href={href(watch.id)}
              scroll={false}
              className={cn(
                'group flex h-full flex-col overflow-hidden rounded-md border bg-surface-raised transition-colors',
                selected ? 'border-[1.5px] border-teal-500' : 'border-line-subtle hover:border-line-strong',
              )}
            >
              <Photo watch={watch} dimmed={sold} showTrade={showTrade} />

              <div className="flex flex-1 flex-col gap-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-caption font-bold text-navy-700">{watch.stockNo}</span>
                  {/*
                    Two dots, two different facts, both labelled.

                    Alex: "Remove the in stock tag replace much smaller where
                    the amber circle is." The amber circle was already here
                    and is not the status — it is the supplier's compliance
                    check — so the status joins it rather than evicting it.
                    Status first, because it is the one somebody is looking
                    for; each carries its own words for a pointer and for a
                    screen reader, since a bare colour says nothing to anyone
                    reading a printed sheet.
                  */}
                  <span className="flex shrink-0 items-center gap-1.5">
                    <StatusDot status={watch.status as WatchStatus} />
                    <CheckDot
                      tone={checks.tone}
                      label={`${CHECK_TONE_LABELS[checks.tone]} — ${checks.summary}`}
                    />
                  </span>
                </div>

                <span className="truncate text-small font-bold text-content-primary" title={`${watch.brandName} ${watch.model}`}>
                  {watch.brandName}
                </span>
                {/* The year rides on the reference line rather than taking
                    one of its own: it is read together with the reference —
                    a 116520 from 2016 is a different watch to price than one
                    from 1999 — and a card that grows a line per fact stops
                    fitting six to a row. */}
                <span className="truncate text-caption text-content-secondary" title={watch.model}>
                  {watch.model}
                  {watch.year !== null && ` · ${watch.year}`}
                  {watch.productType !== 'WATCH' && ` · ${PRODUCT_TYPE_LABELS[watch.productType]}`}
                </span>

                {/*
                  The money, read down the left edge.

                  Alex: "Left align the costs and put trade in small to the
                  right of the price." Right-aligned it was a column of
                  figures with nothing to start from, each one beginning at a
                  different place because each is a different length; against
                  the left edge they stack under the reference above them and
                  the eye has one line to follow.

                  Cost above, at the same size as the figure under it, so the
                  two read down the card as what it cost and then what it is
                  worth — the order they are thought about in, and the one
                  that makes the gap between them legible without doing the
                  sum. No label, and not greyed down: this card is only ever
                  read by people who are allowed the number, and shrinking it
                  was treating it as an aside when it is half the point of
                  looking. Weight alone separates them — the asking price is
                  the bold one.

                  Each figure is behind its own permission, so a card can show
                  one, both or neither. Nothing stands in for a figure
                  somebody may not see: a placeholder would only advertise
                  what is being withheld.
                */}
                <div className="mt-auto flex flex-col items-start gap-0.5 pt-2">
                  {canSeeCost && (
                    <span className="text-caption text-content-primary">
                      {money(watch.purchasePriceGbp)}
                    </span>
                  )}

                  {/*
                    What another dealer pays, between what it cost and what
                    it is asked for.

                    Alex: "Trade pricing should go in the middle and move the
                    word trade to the right side not the left." It read
                    beside the asking price before, which put the three
                    figures in no particular order; down the card they now
                    climb — paid, trade, retail — and the two gaps anybody
                    works out in their head are each between neighbours.

                    The word after the figure, not before it, so the three
                    numbers start on one line down the left and the eye
                    compares them without stepping over a label. Same size as
                    the cost above it; the asking price is the bold one and
                    does not need the other two shrunk to say so.

                    Only when there is one — a watch never offered to the
                    trade has nothing to say here, and a dash on every card
                    would be three cards in four saying nothing.
                  */}
                  {!sold && canSeeRevenue && watch.tradePriceGbp !== null && (
                    <span className="flex items-baseline gap-1.5 text-caption text-content-primary">
                      {money(watch.tradePriceGbp)}
                      <span className="text-micro text-content-secondary">Trade</span>
                    </span>
                  )}

                  {/* Sold rows show what they made, live ones what they ask. */}
                  {sold
                    ? canSeeRevenue && watch.soldAmountGbp !== null && (
                      <span className="text-caption font-bold text-content-primary">{money(watch.soldAmountGbp)}</span>
                    )
                    : canSeeRevenue && (
                      watch.estSaleGbp === null
                        ? <UnpricedChip />
                        : <span className="text-caption font-bold text-content-primary">{money(watch.estSaleGbp)}</span>
                    )}
                </div>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The photograph, or the absence of one.
 *
 * No stock has a picture on the day this ships, so the empty state is the
 * common case rather than the edge: it says what is missing instead of showing
 * a broken frame, which also makes the gallery the quickest way to see which
 * records still need photographing.
 *
 * Lazy and same-sized: the browser fetches only the cards actually scrolled
 * to, and every image lands in a box of fixed aspect ratio so the grid does
 * not reflow as they arrive. The bytes are already downscaled on upload and
 * served immutably, so a second visit costs nothing.
 */
function Photo({ watch, dimmed, showTrade }: {
  watch: WatchListItem
  dimmed: boolean
  showTrade: boolean
}) {
  // Asked for the trade shot, this shows the trade shot or nothing. It does
  // not quietly fall back to the published photograph, because somebody who
  // turns this on is checking which watches have been shot for the trade —
  // and a grid that answers by showing the other picture answers the
  // question with the one thing that looks like a yes.
  const id = showTrade ? watch.tradeImageId : watch.primaryImageId

  if (!id) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 bg-surface-subtle text-content-muted">
        {showTrade
          ? <Handshake className="h-6 w-6" aria-hidden />
          : <Camera className="h-6 w-6" aria-hidden />}
        <span className="text-micro font-semibold">
          {showTrade ? 'No trade shot' : 'No photograph'}
        </span>
      </div>
    )
  }

  const alt = showTrade
    ? `${watch.brandName} ${watch.model}, stock ${watch.stockNo}, trade photograph`
    : `${watch.brandName} ${watch.model}, stock ${watch.stockNo}`

  // The card is a link to the watch, and that is the right thing for a click
  // on it to do — so enlarging gets its own control in the corner rather than
  // taking the card's click away. It appears on hover and on keyboard focus,
  // and swallows the click before the link sees it.
  return (
    <div className="relative">
      <ZoomButton
        src={`/api/images/${id}`}
        alt={alt}
        caption={`Stock ${watch.stockNo} · ${watch.brandName} ${watch.model}`}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/images/${id}`}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cn(
          'aspect-[4/3] w-full bg-surface-subtle object-cover transition-transform group-hover:scale-[1.02]',
          dimmed && 'opacity-70',
        )}
      />
    </div>
  )
}
