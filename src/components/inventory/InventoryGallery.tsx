'use client'
import Link from 'next/link'
import { Camera } from 'lucide-react'
import { cn } from '@/lib/cn'
import { StatusChip, UnpricedChip, useCurrency } from '@/components/ui'
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
}: {
  items: WatchListItem[]
  selectable: boolean
  isSelected: (id: string) => boolean
  onToggle: (id: string) => void
  canSeeCost: boolean
  canSeeRevenue: boolean
  /** Where a card goes — the drawer, keeping the list behind it. */
  href: (id: string) => string
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
              <Photo watch={watch} dimmed={sold} />

              <div className="flex flex-1 flex-col gap-1 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-caption font-bold text-navy-700">{watch.stockNo}</span>
                  <CheckDot
                    tone={checks.tone}
                    label={`${CHECK_TONE_LABELS[checks.tone]} — ${checks.summary}`}
                  />
                </div>

                <span className="truncate text-small font-bold text-content-primary" title={`${watch.brandName} ${watch.model}`}>
                  {watch.brandName}
                </span>
                <span className="truncate text-caption text-content-secondary" title={watch.model}>
                  {watch.model}
                  {watch.productType !== 'WATCH' && ` · ${PRODUCT_TYPE_LABELS[watch.productType]}`}
                </span>

                <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                  <StatusChip status={watch.status as WatchStatus} />
                  {/* Sold rows show what they made, live ones what they ask.
                      Roles that may not see a figure get no placeholder for
                      it — the gap would only advertise what they cannot see. */}
                  {sold
                    ? canSeeRevenue && watch.soldAmountGbp !== null && (
                      <span className="text-caption font-bold text-content-primary">{money(watch.soldAmountGbp)}</span>
                    )
                    : canSeeRevenue && (
                      watch.estSaleGbp === null
                        ? <UnpricedChip />
                        : <span className="text-caption font-bold text-content-primary">{money(watch.estSaleGbp)}</span>
                    )}
                  {!canSeeRevenue && canSeeCost && (
                    <span className="text-caption text-content-secondary">{money(watch.purchasePriceGbp)}</span>
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
function Photo({ watch, dimmed }: { watch: WatchListItem; dimmed: boolean }) {
  if (!watch.primaryImageId) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 bg-surface-subtle text-content-muted">
        <Camera className="h-6 w-6" aria-hidden />
        <span className="text-micro font-semibold">No photograph</span>
      </div>
    )
  }

  return (
    <img
      src={`/api/images/${watch.primaryImageId}`}
      alt={`${watch.brandName} ${watch.model}, stock ${watch.stockNo}`}
      loading="lazy"
      decoding="async"
      className={cn(
        'aspect-[4/3] w-full bg-surface-subtle object-cover transition-transform group-hover:scale-[1.02]',
        dimmed && 'opacity-70',
      )}
    />
  )
}
