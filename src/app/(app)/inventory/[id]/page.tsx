import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { getWatchDetail } from '@/server/services/watch-service'
import { auditForEntity } from '@/server/services/audit'
import { listImages } from '@/server/services/image-service'
import { ImageGallery } from '@/components/inventory/ImageGallery'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardHeader, CardBody, CardFooter, StatCard, StatusChip, Chip, LinkButton } from '@/components/ui'
import { formatPct } from '@/lib/money'
import { formatBase, formatBaseSigned, describeRate, isCurrency } from '@/lib/currency'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { formatDate, formatDateTime, daysHeld } from '@/lib/dates'
import {
  AUDIT_ACTION_LABELS, BASE_CURRENCY, BOX_PAPERS_LABELS, CONDITION_LABELS,
  type AuditAction, type BoxPapers, type Condition, type WatchStatus,
} from '@/lib/enums'
import { changeValue, fieldLabel } from '@/lib/audit-format'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/** How much of a watch's history belongs on the record itself. */
const TIMELINE_SHOWN = 20

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const record = await getWatchDetail(params.id).catch(() => null)
  return { title: record ? `${record.brand.name} ${record.watch.model}` : 'Watch not found' }
}

/**
 * Full record page.
 *
 * The drawer covers the common case; this page is the deep link — printable,
 * shareable and showing the complete history rather than a truncated timeline.
 */
export default async function WatchDetailPage({ params }: { params: { id: string } }) {
  const user = await requireCapability('watch:read')
  const record = await getWatchDetail(params.id).catch(() => null)
  if (!record) notFound()

  const [timeline, images, rates, preferences] = await Promise.all([
    // One more than we show, so the footer knows whether to offer the rest.
    auditForEntity('Watch', params.id, TIMELINE_SHOWN + 1),
    listImages(params.id),
    getRateTable(),
    getPreferencesFor(user.id),
  ])
  const { watch, brand, supplier, location, sale } = record

  const currency = isCurrency(preferences?.displayCurrency) ? preferences.displayCurrency : BASE_CURRENCY
  const money = (base: number | null) => formatBase(base, currency, rates)
  const signed = (base: number | null) => formatBaseSigned(base, currency, rates)

  // Estimate and cost are both held in GBP, so the margin is computed there
  // and only converted for display — never the other way round.
  const estProfit = watch.estSaleGbp !== null
    ? watch.estSaleGbp - watch.purchasePriceGbp
    : null
  const held = daysHeld(watch.purchaseDate)

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Inventory', href: '/inventory' },
          { label: `Stock ${watch.stockNo}` },
        ]}
        title={`${brand.name} ${watch.model}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip status={watch.status as WatchStatus} />
            <span>Stock No. {watch.stockNo}</span>
            {watch.serial && <span>· Serial {watch.serial}</span>}
          </span>
        }
        actions={can(user.role, 'watch:update')
          ? <LinkButton href={`/inventory/${watch.id}/edit`} variant="secondary" icon={<Pencil className="h-4 w-4" />}>Edit</LinkButton>
          : undefined}
      />

      <section aria-label="Financial summary" className="mb-8 grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-4">
        <StatCard
          label="Purchase price"
          value={money(watch.purchasePriceGbp)}
          caption={currency === BASE_CURRENCY ? undefined : describeRate(currency, rates)}
        />
        <StatCard
          label="Est. sale price"
          value={watch.estSaleGbp !== null ? money(watch.estSaleGbp) : 'Not set'}
          caption={watch.estSaleGbp === null ? 'Needs a price' : 'Target'}
        />
        <StatCard
          label={sale ? 'Actual profit' : 'Est. profit'}
          value={sale ? signed(sale.profitGbp) : estProfit !== null ? signed(estProfit) : '—'}
          caption={sale
            ? formatPct(sale.marginBps / 100)
            : estProfit !== null && watch.purchasePriceGbp > 0
              ? `${formatPct((estProfit / watch.purchasePriceGbp) * 100)} margin`
              : undefined}
          tone="accent"
        />
        <StatCard label="Days held" value={held ?? '—'} caption={`Purchased ${formatDate(watch.purchaseDate)}`} />
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Details" />
          <CardBody>
            <dl className="flex flex-col">
              <Row label="Brand" value={brand.name} />
              <Row label="Reference number" value={watch.model} />
              <Row label="Serial" value={watch.serial ?? 'Not recorded'} />
              <Row label="Year" value={watch.year ? String(watch.year) : '—'} />
              <Row label="Condition" value={CONDITION_LABELS[watch.condition as Condition]} />
              <Row label="Box & papers" value={BOX_PAPERS_LABELS[watch.boxPapers as BoxPapers]} />
              <Row label="Supplier" value={supplier.name} />
              <Row label="Location" value={location.name} />
              <Row label="Added" value={formatDateTime(watch.createdAt)} />
              <Row label="Last updated" value={formatDateTime(watch.updatedAt)} />
            </dl>
            {watch.notes && (
              <div className="mt-5 border-t border-line-subtle pt-4">
                <h3 className="mb-1.5 text-caption font-semibold text-content-secondary">Notes</h3>
                <p className="whitespace-pre-wrap text-small text-content-primary">{watch.notes}</p>
              </div>
            )}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="Images" description="Photographs of the watch and its paperwork" />
            <CardBody>
              <ImageGallery
                watchId={watch.id}
                initial={images.map((image) => ({
                  id: image.id, kind: image.kind, caption: image.caption, byteSize: image.byteSize,
                }))}
                canEdit={can(user.role, 'watch:update')}
              />
            </CardBody>
          </Card>

          {sale && (
            <Card>
              <CardHeader title="Sale" description={`Invoice ${sale.invoiceNo}`} />
              <CardBody>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Row label="Sale date" value={formatDate(sale.saleDate)} />
                  <Row label="Sale amount" value={money(sale.saleAmountGbp)} />
                  <Row label="Customer" value={sale.customerName ?? '—'} />
                  <Row label="Channel" value={sale.channel} />
                </dl>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="History"
              description={timeline.length > TIMELINE_SHOWN
                ? `The ${TIMELINE_SHOWN} most recent changes to this watch`
                : 'Every change to this watch, newest first'}
            />
            <ol className="divide-y divide-line-subtle">
              {timeline.slice(0, TIMELINE_SHOWN).map((entry) => (
                <li key={entry.id} className="flex items-start gap-4 px-6 py-4">
                  <Chip tone="neutral">{AUDIT_ACTION_LABELS[entry.action as AuditAction]}</Chip>
                  <div className="min-w-0 flex-1">
                    <p className="text-small text-content-primary">{entry.summary ?? '—'}</p>
                    {entry.changes && (
                      <ul className="mt-1.5 flex flex-col gap-0.5">
                        {Object.entries(entry.changes).map(([field, change]) => (
                          <li key={field} className="text-caption text-content-secondary">
                            <span className="font-semibold">{fieldLabel(field)}</span>:{' '}
                            {changeValue(change.from)} → {changeValue(change.to)}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-caption text-content-secondary">
                      {entry.actor?.name ?? 'System'} · {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            {/* A watch that has been repriced fifty times rendered fifty
                entries and a page nine thousand pixels tall. The rest are one
                click away rather than in front of you. */}
            {timeline.length > TIMELINE_SHOWN && (
              <CardFooter>
                <span className="text-caption text-content-secondary">Older changes are kept in full.</span>
                <Link
                  href={`/settings/audit?entityType=Watch&entityId=${watch.id}`}
                  className="text-small font-bold text-content-accent hover:underline"
                >
                  See this watch&rsquo;s full history →
                </Link>
              </CardFooter>
            )}
          </Card>
        </div>
      </div>

      <p className="mt-8">
        <Link href="/inventory" className="text-small font-bold text-content-accent hover:underline">← Back to inventory</Link>
      </p>
    </>
  )
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-subtle py-2.5 last:border-0">
      <dt className="text-small text-content-secondary">{label}</dt>
      <dd className="text-right text-small font-bold text-content-primary">{value}</dd>
    </div>
  )
}
