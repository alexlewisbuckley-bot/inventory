import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface MetricDelta {
  /** Percentage change against the comparison period. Null when there is no baseline. */
  pct: number | null
  /** What the comparison is against, e.g. "vs previous 30 days". */
  label: string
  /** When true a fall is the good outcome (e.g. ageing stock). */
  inverted?: boolean
}

/**
 * A headline figure with its direction of travel.
 *
 * A number on its own answers "how much"; the delta answers "is that good?",
 * which is the question an operator actually has. When there is no prior
 * period to compare against we say so rather than rendering a misleading 0%.
 */
export function MetricTile({
  label,
  value,
  caption,
  delta,
  href,
  icon,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  caption?: ReactNode
  delta?: MetricDelta
  href?: string
  icon?: ReactNode
  tone?: 'default' | 'accent'
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption font-semibold text-content-secondary">{label}</p>
        {icon && <span className="text-content-secondary" aria-hidden>{icon}</span>}
      </div>
      <p className={cn(
        'mt-2 text-h3 font-extrabold tabular-nums sm:text-h2',
        tone === 'accent' ? 'text-content-accent' : 'text-content-primary',
      )}>
        {value}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {delta && <DeltaBadge {...delta} />}
        {caption && <span className="text-caption text-content-secondary">{caption}</span>}
      </div>
      {href && (
        <span className="mt-3 inline-flex items-center gap-1 text-caption font-bold text-content-accent">
          View <ArrowRight className="h-3 w-3" aria-hidden />
        </span>
      )}
    </>
  )

  const shell = 'rounded-lg border border-line-subtle bg-surface-raised px-4 py-3.5 shadow-card sm:px-5 sm:py-4'

  if (!href) return <div className={shell}>{body}</div>

  return (
    <Link
      href={href}
      className={cn(
        shell,
        'block transition-colors hover:border-line-strong',
      )}
    >
      {body}
    </Link>
  )
}

function DeltaBadge({ pct, label, inverted = false }: MetricDelta) {
  if (pct === null || !Number.isFinite(pct)) {
    return <span className="text-caption text-content-secondary">No prior period</span>
  }

  const rounded = Math.round(pct)
  const flat = rounded === 0
  const rising = rounded > 0
  const good = flat ? null : rising !== inverted

  const Icon = flat ? Minus : rising ? TrendingUp : TrendingDown

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-caption font-bold tabular-nums',
        good === null && 'bg-surface-subtle text-content-secondary',
        good === true && 'bg-state-success/12 text-state-success',
        good === false && 'bg-state-danger/12 text-state-danger',
      )}
      title={`${rising ? 'Up' : flat ? 'Level' : 'Down'} ${Math.abs(rounded)}% ${label}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {rising && '+'}{rounded}%
      <span className="font-normal text-content-secondary">{label}</span>
    </span>
  )
}

/** Percentage change, guarding the divide-by-zero that a first period always hits. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}
