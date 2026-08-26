import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { PageHeader } from '@/components/layout/PageHeader'
import { InvoiceDropZone } from '@/components/inventory/InvoiceDropZone'
import { aiConfigured } from '@/server/services/invoice-ai'

export const metadata: Metadata = { title: 'Book in from an invoice' }
export const dynamic = 'force-dynamic'

/**
 * Reading a document and creating stock takes longer than a page render.
 *
 * 60s is the ceiling on Vercel's Hobby plan; the extraction call is capped
 * below it so a slow read falls back to pattern matching rather than being
 * killed halfway through with the transaction open.
 */
export const maxDuration = 60

export default async function InvoiceIntakePage() {
  await requireCapability('data:import')

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'From an invoice' }]}
        title="Book in from an invoice"
        description="Drop the supplier's invoice and the watches on it go straight into stock — no form, no retyping."
      />
      <div className="max-w-3xl">
        <InvoiceDropZone aiEnabled={aiConfigured()} />
      </div>
    </>
  )
}
