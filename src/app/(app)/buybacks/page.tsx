import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { listBuybacks, listBuybackCharges } from '@/server/services/buyback-service'
import { listSalesPeople } from '@/server/services/reference-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { BuybackManager } from '@/components/buybacks/BuybackManager'

export const metadata: Metadata = { title: 'Buy-backs' }

/**
 * Never cached.
 *
 * Interest accrues on read, so a cached page is a page showing what was
 * owed the last time somebody happened to load it — and the one moment
 * the figure has to be right is the moment it is being looked at.
 */
export const dynamic = 'force-dynamic'

export default async function BuybacksPage() {
  const user = await requireCapability('buyback:read')
  const [loans, charges, people] = await Promise.all([
    listBuybacks(),
    listBuybackCharges(),
    listSalesPeople(),
  ])

  return (
    <>
      <PageHeader
        title="Buy-backs"
        description="Money lent against watches held as security. Interest builds up every month a loan is open; the watches stay out of stock until one is not redeemed."
      />
      <BuybackManager
        canWrite={can(user.role, 'buyback:write')}
        people={people.map((person) => ({ id: person.id, name: person.name }))}
        loans={loans.map((loan) => ({
          id: loan.id,
          reference: loan.reference,
          customerName: loan.customerName,
          principalBase: loan.principalBase,
          rateBps: loan.rateBps,
          monthlyBase: loan.monthlyBase,
          startedOn: loan.startedOn.toISOString(),
          dueOn: loan.dueOn?.toISOString() ?? null,
          status: loan.status,
          chargedBase: loan.chargedBase,
          paidBase: loan.paidBase,
          items: loan.items,
        }))}
        charges={charges.map((charge) => ({
          id: charge.id,
          buybackId: charge.buybackId,
          kind: charge.kind,
          periodIndex: charge.periodIndex,
          dueOn: charge.dueOn.toISOString(),
          amountBase: charge.amountBase,
          paymentStatus: charge.paymentStatus,
        }))}
      />
    </>
  )
}
