'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRightLeft, Pencil, Receipt } from 'lucide-react'
import { Drawer, Button, LinkButton, StatusChip, Chip, useToast } from '@/components/ui'
import { formatMoney, formatSigned, formatPct } from '@/lib/money'
import { formatDate, relativeTime } from '@/lib/dates'
import {
  AUDIT_ACTION_LABELS, BOX_PAPERS_LABELS, CONDITION_LABELS,
  type AuditAction, type BoxPapers, type Condition, type WatchStatus,
} from '@/lib/enums'
import type { Capability } from '@/lib/permissions'
import { MoveWatchModal } from './MoveWatchModal'
import { ImageGallery, type GalleryImage } from './ImageGallery'
import { RecordSaleModal } from './RecordSaleModal'

export interface DrawerRecord {
  id: string
  stockNo: number
  model: string
  nickname: string | null
  serial: string | null
  status: string
  version: number
  condition: string
  boxPapers: string
  year: number | null
  notes: string | null
  purchaseDate: string
  purchasePriceGbp: number
  purchasePriceUsd: number | null
  estSaleUsd: number | null
  brandName: string
  supplierName: string
  locationName: string
  locationId: string
  createdByName: string
  sale: { invoiceNo: string; saleDate: string; amountUsd: number; profitUsd: number; marginBps: number } | null
}

export interface TimelineEntry {
  id: string; action: string; summary: string | null; actorName: string; createdAt: string
}

/** Detail panel: facts, financials, actions and the full change history. */
export function WatchDrawerClient({ record, timeline, images, capabilities }: {
  record: DrawerRecord
  timeline: TimelineEntry[]
  images: GalleryImage[]
  capabilities: Record<Capability, boolean>
}) {
  const router = useRouter()
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

  const estProfit = record.estSaleUsd !== null && record.purchasePriceUsd !== null
    ? record.estSaleUsd - record.purchasePriceUsd
    : null
  const estMargin = estProfit !== null && record.purchasePriceUsd
    ? (estProfit / record.purchasePriceUsd) * 100
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
          </>
        }
        title={record.model}
        subtitle={[record.brandName, record.nickname, record.year].filter(Boolean).join(' · ')}
        footer={
          <div className="flex flex-wrap items-center gap-2.5">
            {capabilities['sale:create'] && !sold && (
              <Button size="sm" icon={<Receipt className="h-4 w-4" />} onClick={() => setSaleOpen(true)}>
                Record sale
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
          <Fact label="Box & papers" value={BOX_PAPERS_LABELS[record.boxPapers as BoxPapers]} />
          <Fact label="Supplier" value={record.supplierName} />
          <Fact label="Purchased" value={formatDate(record.purchaseDate)} />
          <Fact label="Location" value={record.locationName} />
          <Fact label="Added by" value={record.createdByName} />
        </dl>

        <section aria-label="Financials" className="mb-6 rounded-md bg-surface-subtle p-4">
          <h3 className="mb-3 text-micro font-semibold uppercase tracking-wide text-content-secondary">Financials</h3>
          <dl className="flex flex-col gap-2.5">
            <Money label="Purchase price" value={`${formatMoney(record.purchasePriceGbp, 'GBP')} · ${formatMoney(record.purchasePriceUsd, 'USD')}`} />
            <Money label="Est. sale price" value={record.estSaleUsd !== null ? formatMoney(record.estSaleUsd, 'USD') : 'Not set'} muted={record.estSaleUsd === null} />
            <Money
              label="Est. profit"
              value={estProfit !== null ? `${formatSigned(estProfit, 'USD')}${estMargin !== null ? `  (${formatPct(estMargin)})` : ''}` : '—'}
              tone={estProfit !== null && estProfit >= 0 ? 'accent' : estProfit !== null ? 'danger' : undefined}
            />
            <div className="my-1 h-px bg-line-subtle" />
            {record.sale ? (
              <>
                <Money label="Actual sale" value={formatMoney(record.sale.amountUsd, 'USD')} />
                <Money
                  label="Actual profit"
                  value={`${formatSigned(record.sale.profitUsd, 'USD')}  (${formatPct(record.sale.marginBps / 100)})`}
                  tone={record.sale.profitUsd >= 0 ? 'accent' : 'danger'}
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
            <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-content-secondary">Notes</h3>
            <p className="whitespace-pre-wrap text-small text-content-primary">{record.notes}</p>
          </section>
        )}

        <section aria-label="Activity">
          <h3 className="mb-3 text-micro font-semibold uppercase tracking-wide text-content-secondary">Activity</h3>
          <ol className="flex flex-col gap-3.5">
            {timeline.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-500" aria-hidden />
                <div className="min-w-0">
                  <p className="text-small text-content-primary">
                    {entry.summary ?? AUDIT_ACTION_LABELS[entry.action as AuditAction]}
                  </p>
                  <p className="text-caption text-content-secondary">
                    {entry.actorName} · {relativeTime(entry.createdAt)}
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
      <RecordSaleModal
        open={saleOpen}
        onClose={() => setSaleOpen(false)}
        watch={record}
        onRecorded={() => { toast.success('Sale recorded'); router.refresh() }}
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
