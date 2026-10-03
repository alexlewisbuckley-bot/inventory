import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireAnyCapability } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { getEnquiry } from '@/server/services/trade-enquiry-service'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { Chip } from '@/components/ui'
import { EnquiryThread } from '@/components/catalogue/EnquiryThread'
import { formatBase, isCurrency } from '@/lib/currency'
import {
  DEFAULT_DISPLAY_CURRENCY, TRADE_ENQUIRY_KIND_LABELS, TRADE_ENQUIRY_STATUS_LABELS,
  TRADE_ENQUIRY_STATUS_TONE, type CurrencyCode, type TradeEnquiryKind, type TradeEnquiryStatus,
} from '@/lib/enums'

export const metadata: Metadata = { title: 'Enquiry' }
export const dynamic = 'force-dynamic'

/**
 * One enquiry, as a conversation.
 *
 * Opening it marks it read for whichever side opened it, which is why the
 * service does that rather than the page: the read is a write, and it belongs
 * where the other writes are.
 */
export default async function EnquiryPage({ params }: { params: { id: string } }) {
  const user = await requireAnyCapability('trade:enquire', 'trade:respond')
  const canDecide = can(user.role, 'trade:respond')

  const found = await getEnquiry(params.id, user)
  if (!found) notFound()

  const [rates, preferences] = await Promise.all([getRateTable(), getPreferencesFor(user.id)])
  const currency: CurrencyCode = isCurrency(preferences?.displayCurrency)
    ? preferences.displayCurrency
    : DEFAULT_DISPLAY_CURRENCY

  const { enquiry, traderName, dealReference, messages } = found
  const status = enquiry.status as TradeEnquiryStatus

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Enquiries', href: '/enquiries' }, { label: enquiry.subject }]}
        title={enquiry.subject}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Chip tone={TRADE_ENQUIRY_STATUS_TONE[status]}>{TRADE_ENQUIRY_STATUS_LABELS[status]}</Chip>
            <span>{TRADE_ENQUIRY_KIND_LABELS[enquiry.kind as TradeEnquiryKind]}</span>
            {enquiry.offerGbp !== null && (
              <span className="tabular-nums font-semibold text-content-primary">
                {formatBase(enquiry.offerGbp, currency, rates)}
              </span>
            )}
            {canDecide && traderName && <span>{traderName}</span>}
          </span>
        }
      />

      <div className="max-w-3xl">
        <EnquiryThread
          enquiryId={enquiry.id}
          meId={user.id}
          open={status === 'OPEN'}
          canDecide={canDecide && status === 'OPEN'}
          dealHref={enquiry.dealId && dealReference ? `/deals/${enquiry.dealId}` : null}
          messages={messages.map((m) => ({
            id: m.id,
            body: m.body,
            authorId: m.authorId,
            authorName: m.authorName,
            createdAt: m.createdAt.toISOString(),
          }))}
        />
      </div>
    </>
  )
}
