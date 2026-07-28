import type { Metadata } from 'next'
import Link from 'next/link'
import { Clock } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { findAgeingStock } from '@/server/repositories/watch-repository'
import { db } from '@/server/db/client'
import { appSettings } from '@/server/db/schema'
import { eq } from 'drizzle-orm'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, Table, THead, TBody, TR, TD, TH, StatCard, EmptyState, Chip } from '@/components/ui'
import { formatMoney } from '@/lib/money'
import { formatDate, daysHeld } from '@/lib/dates'

export const metadata: Metadata = { title: 'Ageing stock' }
export const dynamic = 'force-dynamic'

/** Ageing threshold bands, chosen to match how buyers actually triage stock. */
function band(days: number): { label: string; tone: 'neutral' | 'gold' | 'danger' } {
  if (days >= 270) return { label: '9 months+', tone: 'danger' }
  if (days >= 180) return { label: '6–9 months', tone: 'danger' }
  if (days >= 120) return { label: '4–6 months', tone: 'gold' }
  return { label: '3–4 months', tone: 'neutral' }
}

export default async function AgeingReportPage() {
  await requireCapability('report:read')

  const setting = await db.select().from(appSettings)
    .where(eq(appSettings.key, 'inventory.ageingWarningDays')).limit(1)
  const threshold = Number(setting[0]?.value) || 90

  const rows = await findAgeingStock(threshold, 200)
  const capital = rows.reduce((sum, row) => sum + row.purchasePriceGbp, 0)
  const oldest = rows[0] ? daysHeld(rows[0].purchaseDate) : null

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Ageing stock' }]}
        title="Ageing stock"
        description={`Watches held longer than ${threshold} days, oldest first. Capital here is not working.`}
      />

      <section aria-label="Ageing summary" className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6">
        <StatCard label="Ageing watches" value={rows.length} caption={`over ${threshold} days held`} />
        <StatCard label="Capital tied up" value={formatMoney(capital, 'GBP')} caption="in ageing stock" />
        <StatCard label="Oldest holding" value={oldest !== null ? `${oldest} days` : '—'} tone={oldest && oldest > 180 ? 'danger' : 'default'} />
      </section>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Clock className="h-6 w-6" />}
            title="Nothing is ageing"
            description={`Every watch in stock was bought within the last ${threshold} days. Capital is turning over well.`}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH width="88px">Stock no</TH>
                <TH>Watch</TH>
                <TH width="130px">Purchased</TH>
                <TH width="100px" align="right">Days held</TH>
                <TH width="130px">Age band</TH>
                <TH width="180px">Location</TH>
                <TH width="120px" align="right">Cost</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => {
                const days = daysHeld(row.purchaseDate) ?? 0
                const { label, tone } = band(days)
                return (
                  <TR key={row.id}>
                    <TD className="font-bold text-navy-700">{row.stockNo}</TD>
                    <TD>
                      <Link href={`/inventory/${row.id}`} className="font-bold text-content-primary hover:underline">
                        {row.brandName} {row.model}
                      </Link>
                    </TD>
                    <TD className="text-content-secondary">{formatDate(row.purchaseDate)}</TD>
                    <TD align="right" className="font-bold">{days}</TD>
                    <TD><Chip tone={tone}>{label}</Chip></TD>
                    {/* Truncated rather than wrapped: a location name breaking onto a
                        second line made that row taller than the ones around
                        it, and a table of uneven rows is harder to scan than
                        one with a name cut short. */}
                    <TD className="text-content-secondary">
                      <span className="block truncate" title={row.locationName}>{row.locationName}</span>
                    </TD>
                    <TD align="right" className="font-bold">{formatMoney(row.purchasePriceGbp, 'GBP')}</TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  )
}
