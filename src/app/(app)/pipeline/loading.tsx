import { Skeleton } from '@/components/ui'

/** The board's outline: columns of cards, not a table. */
export default function Loading() {
  return (
    <div aria-busy aria-live="polite">
      <span className="sr-only">Loading the pipeline…</span>
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-3 h-4 w-80" />

      <div className="mt-8 flex gap-4 overflow-hidden">
        {Array.from({ length: 5 }).map((_, column) => (
          <div key={column} className="w-64 shrink-0">
            <Skeleton className="h-4 w-28" />
            <div className="mt-3 space-y-3">
              {Array.from({ length: 3 - (column % 2) }).map((_, card) => (
                <div key={card} className="rounded-md border border-line-subtle bg-surface-raised p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                  <Skeleton className="mt-3 h-4 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
