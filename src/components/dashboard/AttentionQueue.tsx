import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui'
import { cn } from '@/lib/cn'

export type AttentionSeverity = 'critical' | 'warning' | 'info'

export interface AttentionItem {
  id: string
  /** The count that makes this actionable. Items with 0 are never rendered. */
  count: number
  title: string
  description: string
  href: string
  cta: string
  severity: AttentionSeverity
  icon: ReactNode
}

const SEVERITY_STYLES: Record<AttentionSeverity, { chip: string; rail: string }> = {
  critical: { chip: 'bg-state-danger/12 text-state-danger', rail: 'bg-state-danger' },
  warning: { chip: 'bg-state-gold/15 text-state-gold', rail: 'bg-state-gold' },
  info: { chip: 'bg-teal-500/12 text-content-accent', rail: 'bg-teal-500' },
}

const SEVERITY_ORDER: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 }

/**
 * The single queue of work the business owes itself.
 *
 * Previously these lived as separate cards that appeared and disappeared,
 * which made the dashboard's layout jump about and gave no sense of priority.
 * One ordered list keeps the page stable and makes "what first?" obvious:
 * severity, then size of the problem.
 */
export function AttentionQueue({ items }: { items: AttentionItem[] }) {
  const live = items
    .filter((item) => item.count > 0)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count)

  return (
    <Card>
      <CardHeader
        title="Needs attention"
        description={live.length === 0
          ? 'Nothing outstanding'
          : `${live.length} ${live.length === 1 ? 'thing' : 'things'} to deal with`}
      />
      {live.length === 0 ? (
        <div className="flex items-center gap-3 px-6 pb-6 pt-1">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-state-success/12 text-state-success" aria-hidden>
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <p className="text-small text-content-secondary">
            Every watch is priced, nothing has been sitting too long, and your exchange rates are current.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {live.map((item) => {
            const styles = SEVERITY_STYLES[item.severity]
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="group relative flex items-center gap-4 py-3.5 pl-6 pr-6 transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                >
                  <span className={cn('absolute inset-y-0 left-0 w-0.5', styles.rail)} aria-hidden />
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', styles.chip)} aria-hidden>
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="text-body font-bold tabular-nums text-content-primary">{item.count}</span>
                      <span className="truncate text-body font-bold text-content-primary">{item.title}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-caption text-content-secondary">{item.description}</span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 text-small font-bold text-content-accent group-hover:underline sm:inline-flex">
                    {item.cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
