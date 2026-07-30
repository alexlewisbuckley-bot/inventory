import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { WATCH_STATUS_LABELS, WATCH_STATUS_TONE, type WatchStatus } from '@/lib/enums'

/**
 * Tones, V1 and V2 together during the migration.
 *
 * The V2 names — good, warning, serious, critical — are the four reserved
 * status colours from the design system, and the distinction between serious
 * and critical is the reason there are four: an overdue task and a failed
 * migration must not look identical. The V1 names (success, gold, danger)
 * remain as aliases until every caller has moved; they render the V2 colours
 * already, so the product changes once rather than twice.
 */
export type ChipTone =
  | 'accent' | 'navy' | 'neutral'
  | 'good' | 'warning' | 'serious' | 'critical'
  // V1 aliases, removed when the last caller migrates.
  | 'gold' | 'danger' | 'success'

const TONES: Record<ChipTone, string> = {
  accent: 'bg-teal-100 text-content-accent',
  navy: 'bg-navy-500/15 text-navy-700',
  neutral: 'bg-surface-subtle text-content-secondary border border-line-subtle',
  good: 'bg-state-good/12 text-state-good',
  warning: 'bg-state-warning/14 text-state-warning',
  serious: 'bg-state-serious/12 text-state-serious',
  critical: 'bg-state-critical/12 text-state-critical',
  // Aliases map onto the V2 colours, not the V1 ones, so a screen using the
  // old name still shows the new system.
  gold: 'bg-state-warning/14 text-state-warning',
  danger: 'bg-state-critical/12 text-state-critical',
  success: 'bg-state-good/12 text-state-good',
}

export interface ChipProps {
  tone?: ChipTone
  children: ReactNode
  /** Renders a leading dot. Use `false` for chips that are not status-like. */
  dot?: boolean
  className?: string
}

export function Chip({ tone = 'neutral', dot = false, children, className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-micro font-semibold whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-pill bg-current" aria-hidden />}
      {children}
    </span>
  )
}

/** Status chip bound to the watch status enum so tone and label never drift. */
export function StatusChip({ status, className }: { status: WatchStatus; className?: string }) {
  return (
    <Chip tone={WATCH_STATUS_TONE[status]} dot className={className}>
      {WATCH_STATUS_LABELS[status]}
    </Chip>
  )
}

/** Chip for watches with no estimated sale price — a data-quality prompt. */
export function UnpricedChip() {
  return <Chip tone="neutral">Needs price</Chip>
}
