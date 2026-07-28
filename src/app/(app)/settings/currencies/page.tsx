import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { listRates } from '@/server/services/fx-service'
import { CurrencyRatesForm } from '@/components/settings/CurrencyRatesForm'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Currencies' }
export const dynamic = 'force-dynamic'

export default async function CurrenciesPage() {
  const user = await requireCapability('settings:read')
  const rates = await listRates()

  return (
    <CurrencyRatesForm
      rates={rates.map((rate) => ({
        code: rate.code,
        rate: rate.rate,
        updatedAt: rate.updatedAt.toISOString(),
        updatedByName: rate.updatedByName,
      }))}
      canManage={can(user.role, 'settings:manage')}
    />
  )
}
