import { Skeleton, SkeletonText } from '@/components/ui'

/** A record's outline: identity, chips, stat row, then timeline and panels. */
export default function Loading() {
  return (
    <div aria-busy aria-live="polite">
      <span className="sr-only">Loading the record…</span>
      <Skeleton className="h-9 w-72" />
      <Skeleton className="mt-3 h-4 w-96" />
      <div className="mt-5 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-20 rounded-pill" />
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-line-subtle bg-surface-raised px-6 py-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-28" />
          </div>
        ))}
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-line-subtle bg-surface-raised p-6 lg:col-span-2">
          <Skeleton className="h-5 w-24" />
          <div className="mt-5"><SkeletonText lines={6} /></div>
        </div>
        <div className="space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-line-subtle bg-surface-raised p-6">
              <Skeleton className="h-5 w-28" />
              <div className="mt-4"><SkeletonText lines={3} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
