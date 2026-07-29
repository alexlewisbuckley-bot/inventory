import { notFound } from 'next/navigation'
import { getWatchDetail } from '@/server/services/watch-service'
import { auditForEntity } from '@/server/services/audit'
import { listImages } from '@/server/services/image-service'
import { customerOptions, openDealsByWatch } from '@/server/repositories/crm-repository'
import { WatchDrawerClient } from './WatchDrawerClient'
import type { Capability } from '@/lib/permissions'

/**
 * Server wrapper for the detail drawer.
 *
 * Rendering the drawer from a `?watch=` search param means opening a record is
 * a shareable URL and a back-button-friendly navigation, while the list behind
 * it keeps its scroll position and selection.
 */
export async function WatchDrawer({ watchId, capabilities }: {
  watchId: string
  capabilities: Record<Capability, boolean>
}) {
  const record = await getWatchDetail(watchId).catch(() => null)
  if (!record) notFound()

  const [timeline, images, customers, dealsByWatch] = await Promise.all([
    auditForEntity('Watch', watchId, 12),
    listImages(watchId),
    capabilities['customer:read'] ? customerOptions() : Promise.resolve([]),
    capabilities['deal:read']
      ? openDealsByWatch()
      : Promise.resolve({} as Awaited<ReturnType<typeof openDealsByWatch>>),
  ])

  return (
    <WatchDrawerClient
      record={{
        id: record.watch.id,
        stockNo: record.watch.stockNo,
        model: record.watch.model,
        serial: record.watch.serial,
        status: record.watch.status,
        version: record.watch.version,
        condition: record.watch.condition,
        boxPapers: record.watch.boxPapers,
        year: record.watch.year,
        notes: record.watch.notes,
        purchaseDate: record.watch.purchaseDate.toISOString(),
        purchasePriceGbp: record.watch.purchasePriceGbp,
        estSaleGbp: record.watch.estSaleGbp,
        brandName: record.brand.name,
        supplierName: record.supplier.name,
        locationName: record.location.name,
        locationId: record.location.id,
        createdByName: record.createdByName,
        sale: record.sale
          ? {
              invoiceNo: record.sale.invoiceNo,
              saleDate: record.sale.saleDate.toISOString(),
              amountGbp: record.sale.saleAmountGbp,
              profitGbp: record.sale.profitGbp,
              marginBps: record.sale.marginBps,
            }
          : null,
      }}
      images={images.map((image) => ({
        id: image.id, kind: image.kind, caption: image.caption, byteSize: image.byteSize,
      }))}
      timeline={timeline.map((entry) => ({
        id: entry.id,
        action: entry.action,
        summary: entry.summary,
        actorName: entry.actor?.name ?? 'System',
        createdAt: entry.createdAt.toISOString(),
      }))}
      capabilities={capabilities}
      customers={customers}
      deals={dealsByWatch[watchId] ?? []}
    />
  )
}
