import { SkeletonCards, SkeletonTable, Skeleton } from '@/components/ui'

/** Route-level loading state, matching the shape of the page beneath it. */
export default function Loading() {
  return (
    <div aria-busy aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="mt-3 h-4 w-96" />
      <div className="mt-8"><SkeletonCards count={4} /></div>
      <div className="mt-8 overflow-hidden rounded-lg border border-line-subtle bg-surface-raised">
        <SkeletonTable rows={8} columns={7} />
      </div>
    </div>
  )
}
