import { Check, CircleDot, X } from 'lucide-react'
import { humanDuration, stageHistory, stagePosition, type StageEvent } from '@/lib/deal-stages'
import { DEAL_STAGE_LABELS, OPEN_DEAL_STAGES, type DealStage } from '@/lib/enums'
import { cn } from '@/lib/cn'

/**
 * Where the deal has been, and how long it sat there.
 *
 * `deal_stage_events` has been written since the CRM shipped and read by
 * nothing. This is the screen that reads it, and the reason to: a board of
 * cards can tell you a deal is in Negotiation, and only this can tell you it
 * has been in Negotiation for three weeks. That second fact is the one that
 * decides whether somebody picks up the phone.
 *
 * Filled pips are stages the deal has actually been in. The marker is where it
 * is *now*. Those are different when a deal falls back — a deal that reached
 * Negotiation and dropped to Qualified has a filled pip ahead of its marker,
 * which is the truth and reads correctly once you have seen it happen.
 *
 * A duration nobody measured is shown as an em dash rather than a zero. Zero
 * means "passed through instantly"; the dash means "we have no record", and a
 * rail that cannot tell you which is which is a rail you stop trusting.
 */
export function StageRail({ createdAt, events, stage, lostReason }: {
  createdAt: Date
  events: StageEvent[]
  stage: DealStage
  lostReason?: string | null
}) {
  const history = stageHistory({ createdAt, events, currentStage: stage })
  const closed = stage === 'WON' || stage === 'LOST'

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex items-stretch gap-1 overflow-x-auto scroll-region" role="list">
        {OPEN_DEAL_STAGES.map((step) => {
          const position = stagePosition(step, stage)
          const reached = history.reached.includes(step)
          const dwell = history.dwellByStage[step]
          const current = position === 'current'

          return (
            <li key={step} className="flex min-w-[92px] flex-1 flex-col gap-1.5">
              <span
                className={cn(
                  'h-1 rounded-pill transition-colors',
                  current ? 'bg-teal-500'
                    : reached ? 'bg-navy-500'
                    : 'bg-line-subtle',
                )}
                aria-hidden
              />
              <span className={cn(
                'text-micro font-semibold uppercase tracking-wide',
                current ? 'text-content-accent' : reached ? 'text-content-primary' : 'text-content-secondary',
              )}>
                {DEAL_STAGE_LABELS[step]}
              </span>
              <span className="text-caption tabular-nums text-content-secondary">
                {dwell === undefined
                  ? <span aria-label="never reached">—</span>
                  : current
                    ? `${humanDuration(dwell)} so far`
                    : humanDuration(dwell)}
              </span>
              {/* The marker is announced rather than only drawn: a rail whose
                  only statement of "you are here" is a colour is a rail a
                  screen reader cannot convey. */}
              <span className="sr-only">
                {current ? 'Current stage. ' : reached ? 'Completed. ' : 'Not reached. '}
              </span>
            </li>
          )
        })}
      </ol>

      {closed && (
        <p className={cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-small font-semibold',
          stage === 'WON'
            ? 'bg-state-success/10 text-state-success'
            : 'bg-state-danger/10 text-state-danger',
        )}>
          {stage === 'WON'
            ? <Check className="h-4 w-4 shrink-0" aria-hidden />
            : <X className="h-4 w-4 shrink-0" aria-hidden />}
          {stage === 'WON'
            ? `Won after ${humanDuration(history.ageMs)}.`
            : `Lost after ${humanDuration(history.ageMs)}${lostReason ? ` — ${lostReason}` : ''}.`}
        </p>
      )}

      {!closed && (
        <p className="flex items-center gap-2 text-caption text-content-secondary">
          <CircleDot className="h-3.5 w-3.5 shrink-0 text-content-accent" aria-hidden />
          In {DEAL_STAGE_LABELS[stage].toLowerCase()} for {humanDuration(history.currentMs)}
          {' · '}
          open {humanDuration(history.ageMs)}
          {history.visits.some((visit) => visit.inferred) && (
            <span className="text-content-muted">
              · some moves were made before this was recorded
            </span>
          )}
        </p>
      )}
    </div>
  )
}
