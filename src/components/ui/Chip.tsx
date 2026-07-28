import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { WATCH_STATUS_LABELS, WATCH_STATUS_TONE, type WatchStatus } from '@/lib/enums'

export type ChipTone = 'accent' | 'gold' | 'navy' | 'neutral' | 'danger' | 'success'

const TONES: Record<ChipTone, string> = {
  accent: 'bg-teal-100 text-content-accent',
  gold: 'bg-state-gold/18 text-navy-700 dark:text-state-gold',
  navy: 'bg-navy-500/15 text-navy-700',
  neutral: 'bg-surface-subtle text-content-secondary border border-line-subtle',
  danger: 'bg-state-danger/15 text-state-danger',
  success: 'bg-state-success/15 text-state-success',
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
