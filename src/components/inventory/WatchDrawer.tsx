import { notFound } from 'next/navigation'
import { getWatchDetail } from '@/server/services/watch-service'
import { auditForEntity } from '@/server/services/audit'
import { listImages } from '@/server/services/image-service'
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

  const [timeline, images] = await Promise.all([
    auditForEntity('Watch', watchId, 12),
    listImages(watchId),
  ])

  return (
    <WatchDrawerClient
      record={{
        id: record.watch.id,
        stockNo: record.watch.stockNo,
        model: record.watch.model,
        nickname: record.watch.nickname,
        serial: record.watch.serial,
        status: record.watch.status,
        version: record.watch.version,
        condition: record.watch.condition,
        boxPapers: record.watch.boxPapers,
        year: record.watch.year,
        notes: record.watch.notes,
        purchaseDate: record.watch.purchaseDate.toISOString(),
        purchasePriceGbp: record.watch.purchasePriceGbp,
        purchasePriceUsd: record.watch.purchasePriceUsd,
        estSaleUsd: record.watch.estSaleUsd,
        brandName: record.brand.name,
        supplierName: record.supplier.name,
        locationName: record.location.name,
        locationId: record.location.id,
        createdByName: record.createdByName,
        sale: record.sale
          ? {
              invoiceNo: record.sale.invoiceNo,
              saleDate: record.sale.saleDate.toISOString(),
              amountUsd: record.sale.saleAmountUsd,
              profitUsd: record.sale.profitUsd,
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
    />
  )
}
