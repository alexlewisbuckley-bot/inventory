import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { listLocations } from '@/server/services/reference-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationManager } from '@/components/reference/LocationManager'
import { can } from '@/lib/permissions'
import type { LocationType } from '@/lib/enums'

export const metadata: Metadata = { title: 'Locations' }
export const dynamic = 'force-dynamic'

export default async function LocationsPage() {
  const user = await requireCapability('location:read')
  const locations = await listLocations()

  return (
    <>
      <PageHeader
        title="Locations"
        description="Stores, vaults and transit. Every watch sits in exactly one, and every move is logged."
      />
      <LocationManager
        locations={locations.map((l) => ({
          ...l,
          type: l.type as LocationType,
          watchCount: Number(l.watchCount),
          valueGbp: Number(l.valueGbp),
        }))}
        canManage={can(user.role, 'location:manage')}
      />
    </>
  )
}
