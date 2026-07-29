import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { findCustomers } from '@/server/repositories/crm-repository'
import { assignableUsers } from '@/server/services/crm-service'
import { customerQuerySchema } from '@/lib/validation'
import { PageHeader } from '@/components/layout/PageHeader'
import { CustomerTable } from '@/components/crm/CustomerTable'
import { CustomerFormPanel } from '@/components/crm/CustomerFormPanel'
import { db } from '@/server/db/client'
import { brands, suppliers } from '@/server/db/schema'
import { asc, isNull } from 'drizzle-orm'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Customers' }
export const dynamic = 'force-dynamic'

/** Query strings arrive as single values; the schema wants arrays. */
const list = (value: string | string[] | undefined): string[] | undefined => {
  if (!value) return undefined
  return Array.isArray(value) ? value : [value]
}

export default async function CustomersPage({ searchParams }: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const user = await requireCapability('customer:read')

  const query = customerQuerySchema.parse({
    q: searchParams.q,
    tier: list(searchParams.tier),
    customerType: list(searchParams.customerType),
    status: list(searchParams.status),
    leadSource: list(searchParams.leadSource),
    ownerId: list(searchParams.ownerId),
    sort: searchParams.sort ?? 'name',
    dir: searchParams.dir ?? 'asc',
    page: searchParams.page ?? 1,
    perPage: searchParams.perPage ?? 25,
  })

  const [result, owners, brandRows, supplierRows] = await Promise.all([
    findCustomers(query),
    assignableUsers(),
    db.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)
      .where(isNull(suppliers.deletedAt)).orderBy(asc(suppliers.name)),
  ])

  return (
    <>
      <PageHeader
        title="Customers"
        description="Who you sell to, what they have bought, and what they are waiting for."
        actions={can(user.role, 'customer:create')
          ? <CustomerFormPanel owners={owners} brands={brandRows} suppliers={supplierRows} triggerLabel="Add customer" />
          : undefined}
      />
      <CustomerTable result={result} owners={owners} />
    </>
  )
}
