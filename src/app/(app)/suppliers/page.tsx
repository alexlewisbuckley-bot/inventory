import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { listSuppliers } from '@/server/services/reference-service'
import { listSupplierInvoices } from '@/server/services/invoice-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { CreateAction } from '@/components/ui'
import { SupplierManager, type InvoiceLink } from '@/components/reference/SupplierManager'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Suppliers' }
export const dynamic = 'force-dynamic'

export default async function SuppliersPage() {
  const user = await requireCapability('supplier:read')
  const [suppliers, invoices] = await Promise.all([listSuppliers(), listSupplierInvoices()])

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
        }))}
        invoicesBySupplier={invoicesBySupplier}
        canManage={can(user.role, 'supplier:manage')}
      />
    </>
  )
}
