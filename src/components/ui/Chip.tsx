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
        'inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] whitespace-nowrap',
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

/*
 * The same tones as a dot, for somewhere a chip will not fit.
 *
 * Keyed by tone rather than by status, so a status whose tone changes moves
 * in both places at once. The chip draws its own dot with `bg-current`, off
 * the tone's text colour; these are those colours named directly, because
 * there is no chip around them to inherit from.
 */
const TONE_DOT: Record<ChipTone, string> = {
  accent: 'bg-content-accent',
  navy: 'bg-navy-700',
  neutral: 'bg-content-secondary',
  good: 'bg-state-good',
  warning: 'bg-state-warning',
  serious: 'bg-state-serious',
  critical: 'bg-state-critical',
  gold: 'bg-state-warning',
  danger: 'bg-state-critical',
  success: 'bg-state-good',
}

/**
 * The status as a dot.
 *
 * Alex, on the gallery card: "Remove the in stock tag replace much smaller
 * where the amber circle is." The chip is a hundred pixels of a card a
 * hundred and fifty wide, spent saying what nearly every card says — and
 * the one thing a card is for, the photograph, had to shrink to fit it.
 *
 * A dot only works where the label survives it, so the label is part of
 * the component rather than optional beside it: `title` for a pointer,
 * `sr-only` for everybody else. Colour alone tells nobody anything in a
 * black-and-white screenshot, and the colours here are the chip's own.
 */
export function StatusDot({ status, className }: { status: WatchStatus; className?: string }) {
  const label = WATCH_STATUS_LABELS[status]
  return (
    <span className={cn('inline-flex items-center', className)} title={label}>
      <span className={cn('h-2 w-2 shrink-0 rounded-pill', TONE_DOT[WATCH_STATUS_TONE[status]])} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** Chip for watches with no estimated sale price — a data-quality prompt. */
export function UnpricedChip() {
  return <Chip tone="neutral">Needs price</Chip>
}
