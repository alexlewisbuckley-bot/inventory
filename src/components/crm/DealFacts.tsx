import Link from 'next/link'
import { CalendarDays, Percent, UserRound, Waypoints } from 'lucide-react'
import { Card, CardBody, CardHeader, Chip } from '@/components/ui'
import { formatDate } from '@/lib/dates'
import { DEAL_STAGE_PROBABILITY, LEAD_SOURCE_LABELS, type DealStage, type LeadSource } from '@/lib/enums'

/**
 * The four numbers a deal is argued about.
 *
 * Value, close date, owner and where it came from. Deliberately short: a facts
 * panel that lists twenty fields is one nobody reads, and everything else about
 * a deal is either on the watch panel or in the timeline.
 *
 * The probability is shown with the reason it holds that number. A forecast
 * that says "65%" and cannot say why is a forecast people override until it
 * means nothing; saying "the stage default" or "set by hand" is what makes the
 * override visible.
 */
export function DealFacts({ deal, ownerName, money, action }: {
  deal: {
    valueGbp: number | null
    probability: number
    stage: string
    expectedClose: string | null
    source: string
    notes: string | null
    reference: string
    customerId: string | null
    customerName: string | null
  }
  ownerName: string | null
  money: (value: number | null) => string
  action?: React.ReactNode
}) {
  const stageDefault = DEAL_STAGE_PROBABILITY[deal.stage as DealStage]
  const overdue = deal.expectedClose !== null && new Date(deal.expectedClose) < new Date()
    && deal.stage !== 'WON' && deal.stage !== 'LOST'

  return (
    <Card as="section">
      <CardHeader title="Facts" description={deal.reference} action={action} />
      <CardBody className="flex flex-col gap-4">
        <dl className="flex flex-col gap-3.5">
          <Fact label="Value" icon={<Waypoints className="h-3.5 w-3.5" aria-hidden />}>
            <span className="text-h3 font-extrabold tabular-nums text-content-primary">
              {money(deal.valueGbp)}
            </span>
          </Fact>

          <Fact label="Likelihood" icon={<Percent className="h-3.5 w-3.5" aria-hidden />}>
            <span className="tabular-nums">{deal.probability}%</span>
            <span className="ml-2 text-caption text-content-muted">
              {deal.probability === stageDefault ? 'the stage default' : 'set by hand'}
            </span>
          </Fact>

          <Fact label="Expected to close" icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden />}>
            {deal.expectedClose ? (
              <>
                {formatDate(new Date(deal.expectedClose))}
                {overdue && <Chip tone="danger" className="ml-2">past</Chip>}
              </>
            ) : <span className="text-content-muted">not set</span>}
          </Fact>

          <Fact label="Owner" icon={<UserRound className="h-3.5 w-3.5" aria-hidden />}>
            {ownerName ?? <span className="text-content-muted">nobody</span>}
          </Fact>

          <Fact label="Came from">
            {LEAD_SOURCE_LABELS[deal.source as LeadSource] ?? deal.source}
          </Fact>

          {deal.customerId && (
            <Fact label="Customer">
              <Link href={`/customers/${deal.customerId}`} className="font-semibold text-content-accent hover:underline">
                {deal.customerName ?? 'View record'}
              </Link>
            </Fact>
          )}
        </dl>

        {deal.notes && (
          <div className="border-t border-line-subtle pt-3.5">
            <p className="text-caption font-semibold text-content-secondary">Notes</p>
            <p className="mt-1 whitespace-pre-line text-small text-content-primary">{deal.notes}</p>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function Fact({ label, icon, children }: {
  label: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="flex shrink-0 items-center gap-1.5 text-caption font-semibold text-content-secondary">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 text-right text-small text-content-primary">{children}</dd>
    </div>
  )
}
