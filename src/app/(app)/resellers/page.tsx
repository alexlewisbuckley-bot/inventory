import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { requireCapability } from '@/server/auth/session'
import { listResellers } from '@/server/services/reseller-service'
import { countTradeableStock, listCatalogueLinks } from '@/server/services/catalogue-link-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { CreateAction } from '@/components/ui'
import { ResellerManager } from '@/components/reference/ResellerManager'
import { CatalogueLinkPanel } from '@/components/reference/CatalogueLinkPanel'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Resellers' }
export const dynamic = 'force-dynamic'

export default async function ResellersPage() {
  const user = await requireCapability('reseller:read')
  /*
   * The trade catalogue links live here rather than on /catalogue.
   *
   * /catalogue is the trade partner's own screen and `catalogue:read` is a
   * capability only the TRADER role holds -- deliberately, and a test pins
   * it: `expect(can('OWNER', 'catalogue:read')).toBe(false)`. So the one
   * page that looked like the obvious home for a link to the catalogue is
   * the one page nobody who could issue a link can open.
   *
   * This page is the right home anyway. It is already the answer to "who
   * outside the business can see our stock" -- shop windows and reseller
   * trade rooms -- and it is behind the same `reseller:manage` that issuing
   * a link needs.
   */
  const [resellers, catalogueLinks, tradeableStock] = await Promise.all([
    listResellers(),
    listCatalogueLinks(),
    countTradeableStock(),
  ])

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
      {/*
        Above the resellers, because it is the simplest of the three doors
        and the one somebody reaches for when a dealer asks what we have.
        A reseller's shop window is a relationship; this is a link.
      */}
      {can(user.role, 'reseller:manage') && (
        <CatalogueLinkPanel
          origin={origin}
          stockCount={Number(tradeableStock)}
          // Serialised at the boundary: a Date cannot cross into a client
          // component, and the panel only ever shows it as a day.
          links={catalogueLinks.map((link) => ({
            ...link,
            lastViewedAt: link.lastViewedAt?.toISOString() ?? null,
            createdAt: link.createdAt.toISOString(),
          }))}
        />
      )}

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
