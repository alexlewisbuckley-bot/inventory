'use client'
import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useListQuery } from '@/hooks/useListQuery'
import { useDebounced } from '@/hooks/useDebounced'
import { Button } from '@/components/ui'
import { SALE_CHANNELS, SALE_CHANNEL_LABELS } from '@/lib/enums'

/** Search, channel and date-range filtering for the sales ledger. */
export function SalesFilterBar() {
  const query = useListQuery()
  const [term, setTerm] = useState(query.get('q') ?? '')
  const debounced = useDebounced(term, 300)

  useEffect(() => {
    if (debounced !== (query.get('q') ?? '')) query.set('q', debounced || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-content-secondary" aria-hidden />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search invoice, customer, model or stock no…"
          aria-label="Search sales"
          className="w-full rounded-md border border-line-subtle bg-surface-raised py-3 pl-11 pr-10 text-body text-content-primary placeholder:text-content-secondary hover:border-line-strong focus:border-teal-500"
        />
        {term && (
          <button type="button" onClick={() => setTerm('')} aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm p-1 text-content-secondary hover:text-content-primary">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by channel">
        {SALE_CHANNELS.map((channel) => {
          const active = query.has('channel', channel)
          return (
            <button
              key={channel}
              type="button"
              onClick={() => query.toggle('channel', channel)}
              aria-pressed={active}
              className={
                active
                  ? 'rounded-pill bg-navy-700 px-3.5 py-2 text-caption font-bold text-white'
                  : 'rounded-pill border border-line-subtle bg-surface-raised px-3.5 py-2 text-caption font-semibold text-content-secondary hover:border-line-strong'
              }
            >
              {SALE_CHANNEL_LABELS[channel]}
            </button>
          )
        })}
      </div>

      <label className="flex items-center gap-2 text-caption text-content-secondary">
        <span className="sr-only">Sold from</span>
        <input
          type="date"
          defaultValue={query.get('from') ?? ''}
          onChange={(e) => query.set('from', e.target.value || null)}
          className="rounded-md border border-line-subtle bg-surface-raised px-3 py-2.5 text-small"
        />
      </label>
      <label className="flex items-center gap-2 text-caption text-content-secondary">
        <span className="sr-only">Sold to</span>
        <input
          type="date"
          defaultValue={query.get('to') ?? ''}
          onChange={(e) => query.set('to', e.target.value || null)}
          className="rounded-md border border-line-subtle bg-surface-raised px-3 py-2.5 text-small"
        />
      </label>

      {query.activeFilterCount > 0 && (
        <Button variant="ghost" size="sm" onClick={query.clearAll}>Clear</Button>
      )}
    </div>
  )
}
