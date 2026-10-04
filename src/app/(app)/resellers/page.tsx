import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { requireCapability } from '@/server/auth/session'
import { listResellers } from '@/server/services/reseller-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { CreateAction } from '@/components/ui'
import { ResellerManager } from '@/components/reference/ResellerManager'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Resellers' }
export const dynamic = 'force-dynamic'

export default async function ResellersPage() {
  const user = await requireCapability('reseller:read')
  const resellers = await listResellers()

  // Built from the request rather than an environment variable, so the link
  // copied out of this page is the one that actually reaches this deployment —
  // including a preview URL, where a hard-coded production host would hand
  // somebody a link to the wrong build.
  const host = headers().get('x-forwarded-host') ?? headers().get('host') ?? ''
  const proto = headers().get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const origin = host ? `${proto}://${host}` : ''

  return (
    <>
      <PageHeader
        title="Resellers"
        description="People selling on your behalf. Each gets a branded page showing what is available now, at your retail price — and nothing else about the business."
        actions={can(user.role, 'reseller:manage') ? <CreateAction label="Add reseller" /> : undefined}
      />
      <ResellerManager
        resellers={resellers.map((r) => ({
          ...r,
          availableCount: Number(r.availableCount),
          // Serialised at the boundary: a Date cannot cross into a client
          // component, and the panel only ever shows it as a day.
          customDomainSeenAt: r.customDomainSeenAt?.toISOString() ?? null,
        }))}
        canManage={can(user.role, 'reseller:manage')}
        origin={origin}
      />
    </>
  )
}
