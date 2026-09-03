'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRightLeft, FileText, Pencil, Receipt } from 'lucide-react'
import { Drawer, Button, LinkButton, StatusChip, Chip, useToast, useCurrency } from '@/components/ui'
import { formatPct } from '@/lib/money'
import { formatDate } from '@/lib/dates'
import { RelativeTime } from '@/components/ui/RelativeTime'
import {
  accessoriesLabel, AUDIT_ACTION_LABELS, BOX_PAPERS_LABELS, CONDITION_LABELS, PRODUCT_TYPE_LABELS,
  type AuditAction, type BoxPapers, type Condition, type ProductType, type WatchStatus,
} from '@/lib/enums'
import type { Capability } from '@/lib/permissions'
import type { WatchChecks } from '@/lib/checks'
import { CheckLight } from '@/components/compliance/CheckLight'
import { MoveWatchModal } from './MoveWatchModal'
import { ImageGallery, type GalleryImage } from './ImageGallery'
import { QuickSellModal, type SellCustomerOption, type SellDealOption } from './QuickSellModal'

export interface DrawerRecord {
  id: string
  stockNo: number
  model: string
  serial: string | null
  status: string
  version: number
  productType: ProductType
  condition: string
  boxPapers: string
  year: number | null
  notes: string | null
  purchaseDate: string
  purchasePriceGbp: number
  estSaleGbp: number | null
  brandName: string
  supplierName: string
  locationName: string
  locationId: string
  createdByName: string
  /** The supplier invoice this watch was booked in from, when it came from one. */
  invoice: { id: string; label: string } | null
  /** Both compliance lights, already resolved on the server. */
  checks: WatchChecks
  sale: { invoiceNo: string; saleDate: string; amountGbp: number; profitGbp: number; marginBps: number } | null
}

export interface TimelineEntry {
  id: string; action: string; summary: string | null; actorName: string; createdAt: string
}

/** Detail panel: facts, financials, actions and the full change history. */
export function WatchDrawerClient({
  record, timeline, images, capabilities, customers = [], deals = [],
}: {
  record: DrawerRecord
  timeline: TimelineEntry[]
  images: GalleryImage[]
  capabilities: Record<Capability, boolean>
  customers?: SellCustomerOption[]
  deals?: SellDealOption[]
}) {
  const router = useRouter()
  const { money, signed } = useCurrency()
  const toast = useToast()
  const [moveOpen, setMoveOpen] = useState(false)
  const [saleOpen, setSaleOpen] = useState(false)

  // Closing removes the `watch` param, returning to the plain list URL.
  const close = () => {
    const params = new URLSearchParams(window.location.search)
    params.delete('watch')
    const query = params.toString()
    router.replace(query ? `/inventory?${query}` : '/inventory', { scroll: false })
  }

  const estProfit = record.estSaleGbp !== null ? record.estSaleGbp - record.purchasePriceGbp : null
  const estMargin = estProfit !== null && record.purchasePriceGbp > 0
    ? (estProfit / record.purchasePriceGbp) * 100
    : null
  const sold = record.status === 'SOLD'

  return (
    <>
      <Drawer
        open
        onClose={close}
        eyebrow={
          <>
            <span className="text-caption font-bold text-content-secondary">Stock No. {record.stockNo}</span>
            <StatusChip status={record.status as WatchStatus} />
            {/* Only when it is not a watch. A "Watch" chip on every one of a
                thousand watch records is a label nobody reads. */}
            {record.productType !== 'WATCH' && (
              <Chip tone="navy">{PRODUCT_TYPE_LABELS[record.productType]}</Chip>
            )}
          </>
        }
        title={record.model}
        subtitle={[record.brandName, record.year].filter(Boolean).join(' · ')}
        footer={
          <div className="flex flex-wrap items-center gap-2.5">
            {capabilities['sale:create'] && !sold && (
              <Button size="sm" icon={<Receipt className="h-4 w-4" />} onClick={() => setSaleOpen(true)}>
                Mark as sold
              </Button>
            )}
            {capabilities['watch:move'] && !sold && (
              <Button size="sm" variant="secondary" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setMoveOpen(true)}>
                Move
              </Button>
            )}
            {capabilities['watch:update'] && (
              <LinkButton href={`/inventory/${record.id}/edit`} size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />}>
                Edit
              </LinkButton>
            )}
            <Link href={`/inventory/${record.id}`} className="ml-auto text-small font-bold text-content-accent hover:underline">
              Full record →
            </Link>
          </div>
        }
      >
        <div className="mb-6">
          <ImageGallery
            watchId={record.id}
            initial={images}
            canEdit={capabilities['watch:update']}
          />
        </div>

        <dl className="mb-6">
          <Fact label="Serial" value={record.serial ?? 'Not recorded'} />
          <Fact label="Condition" value={CONDITION_LABELS[record.condition as Condition]} />
          <Fact
            label={accessoriesLabel(record.productType)}
            value={BOX_PAPERS_LABELS[record.boxPapers as BoxPapers]}
          />
          <Fact label="Supplier" value={record.supplierName} />
          <div className="flex items-start justify-between gap-4 border-b border-line-subtle py-2.5 last:border-0">
            <dt className="text-small text-content-secondary">Checks</dt>
            <dd className="flex flex-wrap justify-end gap-1.5">
              <CheckLight state={record.checks.vat} />
              <CheckLight state={record.checks.id} />
              <CheckLight state={record.checks.register} />
            </dd>
          </div>
          <Fact label="Purchased" value={formatDate(record.purchaseDate)} />
          <Fact label="Location" value={record.locationName} />
          <Fact label="Added by" value={record.createdByName} />
          {record.invoice && (
            <div className="flex items-start justify-between gap-4 border-b border-line-subtle py-2.5 last:border-0">
              <dt className="text-small text-content-secondary">Invoice</dt>
              <dd className="text-right">
                <a
                  href={`/api/invoices/${record.invoice.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-small font-bold text-content-accent hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  {record.invoice.label}
                </a>
              </dd>
            </div>
          )}
        </dl>

        <section aria-label="Financials" className="mb-6 rounded-md bg-surface-subtle p-4">
          <h3 className="mb-3 text-caption font-semibold text-content-secondary">Financials</h3>
          <dl className="flex flex-col gap-2.5">
            <Money label="Purchase price" value={money(record.purchasePriceGbp)} />
            <Money label="Est. sale price" value={record.estSaleGbp !== null ? money(record.estSaleGbp) : 'Not set'} muted={record.estSaleGbp === null} />
            <Money
              label="Est. profit"
              value={estProfit !== null ? `${signed(estProfit)}${estMargin !== null ? `  (${formatPct(estMargin)})` : ''}` : '—'}
              tone={estProfit !== null && estProfit >= 0 ? 'accent' : estProfit !== null ? 'danger' : undefined}
            />
            <div className="my-1 h-px bg-line-subtle" />
            {record.sale ? (
              <>
                <Money label="Actual sale" value={money(record.sale.amountGbp)} />
                <Money
                  label="Actual profit"
                  value={`${signed(record.sale.profitGbp)}  (${formatPct(record.sale.marginBps / 100)})`}
                  tone={record.sale.profitGbp >= 0 ? 'accent' : 'danger'}
                />
                <Money label="Invoice" value={`${record.sale.invoiceNo} · ${formatDate(record.sale.saleDate)}`} />
              </>
            ) : (
              <Money label="Actual sale" value="Not sold yet" muted />
            )}
          </dl>
        </section>

        {record.notes && (
          <section aria-label="Notes" className="mb-6">
            <h3 className="mb-2 text-caption font-semibold text-content-secondary">Notes</h3>
            <p className="whitespace-pre-wrap text-small text-content-primary">{record.notes}</p>
          </section>
        )}

        <section aria-label="Activity">
          <h3 className="mb-3 text-caption font-semibold text-content-secondary">Activity</h3>
          <ol className="flex flex-col gap-3.5">
            {timeline.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-pill bg-teal-500" aria-hidden />
                <div className="min-w-0">
                  <p className="text-small text-content-primary">
                    {entry.summary ?? AUDIT_ACTION_LABELS[entry.action as AuditAction]}
                  </p>
                  <p className="text-caption text-content-secondary">
                    {entry.actorName} · <RelativeTime value={entry.createdAt} />
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </Drawer>

      <MoveWatchModal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        watchId={record.id}
        stockNo={record.stockNo}
        model={record.model}
        currentLocationId={record.locationId}
        onMoved={() => { toast.success('Watch moved'); router.refresh() }}
      />
      {/* The same form the inventory row opens. There used to be two, with
          different fields in a different order, which is how one of them ended
          up without any way to attribute the sale to a customer. */}
      <QuickSellModal
        open={saleOpen}
        onClose={() => setSaleOpen(false)}
        watch={{
          id: record.id,
          stockNo: record.stockNo,
          model: record.model,
          brandName: record.brandName,
          purchasePriceGbp: record.purchasePriceGbp,
          estSaleGbp: record.estSaleGbp,
        }}
        customers={customers}
        deals={deals}
        onSold={() => { router.refresh() }}
      />
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line-subtle py-2.5">
      <dt className="text-small text-content-secondary">{label}</dt>
      <dd className="text-small font-bold text-content-primary">{value}</dd>
    </div>
  )
}

function Money({ label, value, tone, muted }: {
  label: string; value: string; tone?: 'accent' | 'danger'; muted?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-small text-content-secondary">{label}</dt>
      <dd className={
        tone === 'accent' ? 'text-body font-bold text-content-accent'
        : tone === 'danger' ? 'text-body font-bold text-state-danger'
        : muted ? 'text-small text-content-secondary'
        : 'text-body font-bold text-content-primary'
      }>
        {value}
      </dd>
    </div>
  )
}

export { Chip }
