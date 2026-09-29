import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { listOwners, countUnowned } from '@/server/services/reference-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { CreateAction } from '@/components/ui'
import { OwnerManager } from '@/components/reference/OwnerManager'
import { can } from '@/lib/permissions'
import type { OwnerType } from '@/lib/enums'

export const metadata: Metadata = { title: 'Owners' }
export const dynamic = 'force-dynamic'

export default async function OwnersPage() {
  const user = await requireCapability('owner:read')
  const [owners, unownedCount] = await Promise.all([listOwners(), countUnowned()])

  return (
    <>
      <PageHeader
        title="Owners"
        description="Whose stock this is. A watch sits in one location and belongs to one owner, and the two change independently."
        actions={can(user.role, 'owner:manage') ? <CreateAction label="Add owner" /> : undefined}
      />
      <OwnerManager
        owners={owners.map((o) => ({
          ...o,
          type: o.type as OwnerType,
          watchCount: Number(o.watchCount),
          valueGbp: Number(o.valueGbp),
        }))}
        unownedCount={unownedCount}
        canManage={can(user.role, 'owner:manage')}
      />
    </>
  )
}
