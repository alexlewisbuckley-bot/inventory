import Link from 'next/link'
import { Phone, Sparkles } from 'lucide-react'
import { Card, CardBody, CardHeader, Chip } from '@/components/ui'
import { RelativeTime } from '@/components/ui/RelativeTime'
import {
  CUSTOMER_TIER_LABELS, CUSTOMER_TYPE_LABELS, type CustomerTier, type CustomerType,
} from '@/lib/enums'
import type { WatchSuggestion } from '@/server/repositories/crm-repository'

/**
 * Who might want this watch.
 *
 * The question somebody asks holding it, and until now the answer lived in
 * whoever happened to remember. Ranked rather than filtered: a short list you
 * could work down in ten minutes beats a complete one nobody starts.
 *
 * Every row says why it is there. A recommendation without a reason is a
 * horoscope, and the reason is usually the opening line of the call.
 */
export function WhoMightWant({ suggestions }: { suggestions: WatchSuggestion[] }) {
  return (
    <Card as="section">
      <CardHeader
        title="Who might want this"
        description="Drawn from what people have bought, asked for and told us they collect."
      />

      {suggestions.length === 0 ? (
        <CardBody className="text-small text-content-secondary">
          Nobody on the book matches this yet. It will fill in as customers buy
          and register what they are looking for.
        </CardBody>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {suggestions.map((person, index) => (
            <li key={person.customerId} className="px-6 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/customers/${person.customerId}`}
                      className="truncate text-small font-bold text-content-primary hover:underline"
                    >
                      {person.name}
                    </Link>
                    {/* The strongest match is worth marking: it is the call to
                        make first, not merely the one sorted highest. */}
                    {index === 0 && person.score >= 60 && (
                      <Chip tone="accent">
                        <Sparkles className="mr-1 h-3 w-3" aria-hidden />
                        Best match
                      </Chip>
                    )}
                    {person.tier !== 'STANDARD' && (
                      <Chip tone={person.tier === 'VIP' ? 'gold' : 'accent'}>
                        {CUSTOMER_TIER_LABELS[person.tier as CustomerTier]}
                      </Chip>
                    )}
                    <Chip tone={person.customerType === 'TRADE' ? 'navy' : 'neutral'}>
                      {CUSTOMER_TYPE_LABELS[person.customerType as CustomerType]}
                    </Chip>
                  </p>

                  {person.company && (
                    <p className="mt-0.5 truncate text-caption text-content-secondary">{person.company}</p>
                  )}

                  <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {person.reasons.map((reason) => (
                      <li key={reason} className="text-caption text-content-secondary">· {reason}</li>
                    ))}
                  </ul>

                  <p className="mt-1.5 text-caption text-content-secondary">
                    {person.lastContactedAt
                      ? <>Last spoken to <RelativeTime value={person.lastContactedAt.toISOString()} /></>
                      : 'Never contacted'}
                  </p>
                </div>

                {person.phone && (
                  <a
                    href={`tel:${person.phone}`}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-line-subtle px-3 text-caption font-bold text-content-primary transition-colors hover:border-line-strong"
                  >
                    <Phone className="h-3.5 w-3.5" aria-hidden />
                    Call
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
