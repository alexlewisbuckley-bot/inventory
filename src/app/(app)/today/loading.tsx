import { Skeleton } from '@/components/ui'

/**
 * Today, before its data.
 *
 * The one shell-wide loading file drew four stat tiles and a table — the
 * shape of the old dashboard — under every route, so this screen skeletoned
 * as a screen that no longer exists and then jumped. Each route now draws
 * its own outline: bands of rows here, at the row height the agenda actually
 * uses, so the loaded state lands in place rather than reflowing.
 */
export default function Loading() {
  return (
    <div aria-busy aria-live="polite">
      <span className="sr-only">Loading your day…</span>
      <Skeleton className="h-9 w-72" />
      <Skeleton className="mt-3 h-4 w-44" />

      {[3, 5].map((rows, band) => (
        <div
          key={band}
          className="mt-6 overflow-hidden rounded-lg border border-line-subtle bg-surface-raised"
        >
          <div className="border-b border-line-subtle px-6 py-3.5">
            <Skeleton className="h-3.5 w-28" />
          </div>
          {Array.from({ length: rows }).map((_, row) => (
            <div key={row} className="flex items-center gap-3 border-b border-line-subtle px-6 py-3 last:border-b-0">
              <Skeleton className="h-5 w-5 rounded-pill" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      ))}

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-line-subtle bg-surface-raised px-6 py-5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-3 h-8 w-32" />
          <Skeleton className="mt-2 h-3.5 w-40" />
        </div>
        <div className="rounded-lg border border-line-subtle bg-surface-raised px-6 py-5 lg:col-span-2">
          <Skeleton className="h-5 w-36" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
    </div>
  )
}
