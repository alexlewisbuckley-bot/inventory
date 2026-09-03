import { cn } from '@/lib/cn'
import { CHECK_TONE_CHIP, type CheckState, type CheckTone } from '@/lib/checks'
import { Chip } from '@/components/ui'

/**
 * One traffic light.
 *
 * A dot alone would be unreadable to anyone who cannot distinguish the
 * colours, and unreadable to everyone in a screenshot printed in black and
 * white, so the label is part of the component rather than optional beside it.
 * `title` carries the sentence for a pointer; the label carries it for
 * everybody else.
 */
export function CheckLight({ state, className }: { state: CheckState; className?: string }) {
  return (
    <Chip tone={CHECK_TONE_CHIP[state.tone]} dot className={className} >
      <span title={state.detail}>{state.label}</span>
    </Chip>
  )
}

const DOT: Record<CheckTone, string> = {
  GREEN: 'bg-state-good',
  AMBER: 'bg-state-warning',
  RED: 'bg-state-critical',
}

/**
 * The compact form, for a table cell.
 *
 * A row has one column of width for this, so the colour does the work and the
 * text is the accessible name rather than visible copy. Still a real label —
 * `aria-label` on a span with a title, not a bare coloured square.
 */
export function CheckDot({ tone, label, className }: { tone: CheckTone; label: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={label}>
      <span className={cn('h-2 w-2 shrink-0 rounded-pill', DOT[tone])} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  )
}
