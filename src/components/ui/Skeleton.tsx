import { cn } from '@/lib/cn'

/** Shimmering placeholder. Always pair with `aria-busy` on the container. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden />
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  )
}

/** Table loading state matching the real row height to avoid layout shift. */
export function SkeletonTable({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-busy aria-label="Loading results">
      <span className="sr-only">Loading results…</span>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-6 py-4 border-b border-line-subtle">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn('h-4', c === 1 ? 'flex-1' : 'w-20')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-busy aria-label="Loading">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg bg-surface-raised border border-line-subtle px-6 py-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-8 w-32" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
      ))}
    </div>
  )
}
