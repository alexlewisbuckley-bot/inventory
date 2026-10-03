import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAnyCapability } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { listEnquiries } from '@/server/services/trade-enquiry-service'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, Chip, EmptyState } from '@/components/ui'
import { MessageSquare } from 'lucide-react'
import { formatBase, isCurrency } from '@/lib/currency'
import { relativeTime } from '@/lib/dates'
import {
  DEFAULT_DISPLAY_CURRENCY, TRADE_ENQUIRY_KIND_LABELS, TRADE_ENQUIRY_STATUS_LABELS,
  TRADE_ENQUIRY_STATUS_TONE, type CurrencyCode, type TradeEnquiryKind, type TradeEnquiryStatus,
} from '@/lib/enums'

export const metadata: Metadata = { title: 'Enquiries' }
export const dynamic = 'force-dynamic'

/**
 * The trade's side of the conversation, and ours.
 *
 * One page for both, scoped by who is reading: a dealer sees their own, the
 * owner sees all of them. Two pages showing the same rows with different
 * permissions is how one of them quietly stops matching the other.
 */
export default async function EnquiriesPage() {
  const user = await requireAnyCapability('trade:enquire', 'trade:respond')
  const mine = user.role === 'TRADER'

  const [rows, rates, preferences] = await Promise.all([
    listEnquiries(user), getRateTable(), getPreferencesFor(user.id),
  ])
  const currency: CurrencyCode = isCurrency(preferences?.displayCurrency)
    ? preferences.displayCurrency
    : DEFAULT_DISPLAY_CURRENCY

  return (
    <>
      <PageHeader
        title="Enquiries"
        description={mine
          ? 'What you have asked about, and what we have said back.'
          : 'What the trade has asked about. Approving one opens a deal; nothing else does.'}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessageSquare className="h-6 w-6" aria-hidden />}
            title={mine ? 'You have not asked about anything yet.' : 'Nothing from the trade yet.'}
            description={mine
              ? 'Press Enquire on anything in the inventory and the conversation starts here.'
              : 'When a trade partner enquires about a watch it lands here, and on your phone.'}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/enquiries/${row.id}`}
                  className="flex items-center gap-4 border-t border-line-subtle px-5 py-3.5 first:border-t-0 hover:bg-surface-subtle"
                >
                  {/* Unread is the only thing worth a mark here: the list is
                      read to find what is waiting on you. */}
                  <span
                    aria-label={row.unread ? 'Unread' : undefined}
                    className={row.unread
                      ? 'h-2 w-2 shrink-0 rounded-full bg-teal-500'
                      : 'h-2 w-2 shrink-0'}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-small font-semibold text-content-primary">
                      {row.subject}
                    </span>
                    <span className="block truncate text-caption text-content-secondary">
                      {!mine && row.traderName ? `${row.traderName} · ` : ''}
                      {TRADE_ENQUIRY_KIND_LABELS[row.kind as TradeEnquiryKind]}
                      {row.offerGbp !== null && ` · ${formatBase(row.offerGbp, currency, rates)}`}
                      {row.messages > 0 && ` · ${row.messages} message${row.messages === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-caption text-content-muted">
                    {relativeTime(row.updatedAt)}
                  </span>
                  <Chip tone={TRADE_ENQUIRY_STATUS_TONE[row.status as TradeEnquiryStatus]}>
                    {TRADE_ENQUIRY_STATUS_LABELS[row.status as TradeEnquiryStatus]}
                  </Chip>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
