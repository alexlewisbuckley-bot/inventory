import Link from 'next/link'
import { cn } from '@/lib/cn'

export interface HealthBucket {
  key: string
  label: string
  count: number
  value: string
  concerning: boolean
  href: string
}

/**
 * How long capital has been sitting.
 *
 * A stacked proportion bar plus a labelled breakdown. Sequential by nature —
 * the buckets are ordered by age, so the encoding is one hue getting darker,
 * not four unrelated colours. The two oldest buckets switch to the warning
 * hue because they are a different *kind* of thing, not just a later step.
 */
export function InventoryHealth({ buckets, total }: { buckets: HealthBucket[]; total: number }) {
  const held = buckets.reduce((sum, bucket) => sum + bucket.count, 0)
  const concerning = buckets.filter((b) => b.concerning).reduce((sum, b) => sum + b.count, 0)
  const healthPct = held === 0 ? 100 : Math.round(((held - concerning) / held) * 100)

  return (
    <div className="px-6 pb-6">
      <div className="flex items-baseline justify-between gap-4">
        <p className={cn(
          'text-h2 font-extrabold tabular-nums',
          // The figure is a verdict, not a statistic — colour it like one.
          healthPct >= 75 ? 'text-state-success' : healthPct >= 50 ? 'text-state-gold' : 'text-state-danger',
        )}>
          {healthPct}%
          <span className="ml-2 text-caption font-normal text-content-secondary">of stock under 90 days</span>
        </p>
      </div>

      {held === 0 ? (
        <p className="mt-3 text-small text-content-secondary">No live stock to assess.</p>
      ) : (
        <>
          <div className="mt-3 flex h-2.5 gap-[2px] overflow-hidden rounded-pill" role="presentation">
            {buckets.filter((b) => b.count > 0).map((bucket, index, live) => (
              <span
                key={bucket.key}
                className={cn('h-full first:rounded-l-pill last:rounded-r-pill', SHADES[bucket.key] ?? 'bg-navy-500')}
                style={{ width: `${(bucket.count / held) * 100}%` }}
                title={`${bucket.label}: ${bucket.count} of ${held}`}
                aria-hidden={index >= live.length}
              />
            ))}
          </div>

          <ul className="mt-4 space-y-2">
            {buckets.map((bucket) => (
              <li key={bucket.key}>
                <Link
                  href={bucket.href}
                  className="-mx-2 flex items-center gap-3 rounded-sm px-2 py-1 transition-colors hover:bg-surface-subtle"
                >
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', SHADES[bucket.key] ?? 'bg-navy-500')} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-small text-content-primary">{bucket.label}</span>
                  <span className="shrink-0 text-caption tabular-nums text-content-secondary">{bucket.value}</span>
                  <span className="w-8 shrink-0 text-right text-small font-bold tabular-nums text-content-primary">
                    {bucket.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {total > held && (
        <p className="mt-4 text-caption text-content-secondary">
          Excludes {total - held} sold or written-off {total - held === 1 ? 'watch' : 'watches'}.
        </p>
      )}
    </div>
  )
}

/** One hue darkening with age, then the warning hue where age becomes a problem. */
const SHADES: Record<string, string> = {
  fresh: 'bg-teal-500',
  settling: 'bg-navy-500',
  watch: 'bg-navy-700',
  ageing: 'bg-state-gold',
  stale: 'bg-state-danger',
}
