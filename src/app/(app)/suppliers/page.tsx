import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { listSuppliers } from '@/server/services/reference-service'
import { listSupplierInvoices } from '@/server/services/invoice-service'
import { listSupplierDocuments } from '@/server/services/compliance-service'
import type { IdDocument } from '@/components/compliance/SupplierIdPanel'
import { PageHeader } from '@/components/layout/PageHeader'
import { CreateAction } from '@/components/ui'
import { SupplierManager, type InvoiceLink } from '@/components/reference/SupplierManager'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Suppliers' }
export const dynamic = 'force-dynamic'

export default async function SuppliersPage() {
  const user = await requireCapability('supplier:read')
  const [suppliers, invoices, documents] = await Promise.all([
    listSuppliers(),
    listSupplierInvoices(),
    // Never their bytes — see listSupplierDocuments. This is the list of what
    // is on file, not the passports themselves.
    listSupplierDocuments(),
  ])

  // Grouped here rather than queried per row: one query for the page beats one
  // per supplier, and the list is small enough to group in memory.
  const invoicesBySupplier: Record<string, InvoiceLink[]> = {}
  for (const invoice of invoices) {
    (invoicesBySupplier[invoice.supplierId] ??= []).push({
      id: invoice.id,
      label: invoice.invoiceNo ?? invoice.fileName,
      date: invoice.invoiceDate ? invoice.invoiceDate.toISOString() : null,
      currency: invoice.currency,
      grossAmount: invoice.grossAmount,
      vatScheme: invoice.vatScheme,
      watchCount: invoice.createdCount,
    })
  }

  const documentsBySupplier: Record<string, IdDocument[]> = {}
  for (const document of documents) {
    (documentsBySupplier[document.supplierId] ??= []).push({
      id: document.id,
      kind: document.kind,
      holderName: document.holderName,
      expiresOn: document.expiresOn,
      fileName: document.fileName,
      byteSize: document.byteSize,
      uploadedByName: document.uploadedByName,
    })
  }

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Who you buy from, what you have bought, and how it has performed."
        actions={can(user.role, 'supplier:manage') ? <CreateAction label="Add supplier" /> : undefined}
      />
      <SupplierManager
        suppliers={suppliers.map((s) => ({
          ...s,
          watchCount: Number(s.watchCount),
          totalCostGbp: Number(s.totalCostGbp),
          inStockCount: Number(s.inStockCount),
          soldCount: Number(s.soldCount),
          vatCheckedAt: s.vatCheckedAt?.toISOString() ?? null,
          idCheckedAt: s.idCheckedAt?.toISOString() ?? null,
        }))}
        invoicesBySupplier={invoicesBySupplier}
        documentsBySupplier={documentsBySupplier}
        canManage={can(user.role, 'supplier:manage')}
      />
    </>
  )
}
