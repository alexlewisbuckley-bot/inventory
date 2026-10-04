import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { syncHealth } from '@/server/services/shopify-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { StorefrontSync } from '@/components/settings/StorefrontSync'

export const metadata: Metadata = { title: 'Online shop' }
export const dynamic = 'force-dynamic'

/**
 * The shop, as a reflection of the book.
 *
 * Under settings rather than beside the stock list because it is a wiring
 * question, not a daily one: the sync runs by itself on every change, and this
 * page exists for the two occasions it does not — the first run, and the day
 * somebody needs to know why a watch is not showing.
 */
export default async function StorefrontPage() {
  await requireCapability('watch:update')
  const health = await syncHealth()

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Online shop' }]}
        title="Online shop"
        description="Stock, prices and photographs are pushed to the shop whenever they change here. Nothing is ever read back."
      />
      <StorefrontSync
        health={{
          ...health,
          lastSyncedAt: health.lastSyncedAt?.toISOString() ?? null,
        }}
      />
    </>
  )
}
