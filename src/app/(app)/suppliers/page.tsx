import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { listSuppliers } from '@/server/services/reference-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { SupplierManager } from '@/components/reference/SupplierManager'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Suppliers' }
export const dynamic = 'force-dynamic'

export default async function SuppliersPage() {
  const user = await requireCapability('supplier:read')
  const suppliers = await listSuppliers()

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Who you buy from, what you have bought, and how it has performed."
      />
      <SupplierManager
        suppliers={suppliers.map((s) => ({
          ...s,
          watchCount: Number(s.watchCount),
          totalCostGbp: Number(s.totalCostGbp),
          inStockCount: Number(s.inStockCount),
          soldCount: Number(s.soldCount),
        }))}
        canManage={can(user.role, 'supplier:manage')}
      />
    </>
  )
}
