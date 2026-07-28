'use client'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { useListQuery } from '@/hooks/useListQuery'
import { useDebounced } from '@/hooks/useDebounced'
import { Button, ToolbarRow, ToolbarSearch, ToolbarDate } from '@/components/ui'
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
    <div className="mb-6 flex flex-col gap-2.5">
      <ToolbarRow>
      <ToolbarSearch
        value={term}
        onChange={setTerm}
        label="Search sales"
        placeholder="Search invoice, customer, reference or stock number…"
      />

      <ToolbarDate label="From" value={query.get('from') ?? ''} onChange={(v) => query.set('from', v || null)} />
      <ToolbarDate label="to" value={query.get('to') ?? ''} onChange={(v) => query.set('to', v || null)} />

      {query.activeFilterCount > 0 && (
        <Button variant="ghost" size="sm" onClick={query.clearAll}>Clear</Button>
      )}
      </ToolbarRow>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by channel">
        <span className="mr-1 text-small text-content-secondary">Channel</span>
        {SALE_CHANNELS.map((channel) => {
          const active = query.has('channel', channel)
          return (
            <button
              key={channel}
              type="button"
              onClick={() => query.toggle('channel', channel)}
              aria-pressed={active}
              className={cn(
                'h-9 rounded-md border px-3 text-small font-semibold transition-colors',
                active
                  ? 'border-navy-700 bg-navy-700 text-white'
                  : 'border-line-subtle bg-surface-raised text-content-secondary hover:border-line-strong hover:text-content-primary',
              )}
            >
              {SALE_CHANNEL_LABELS[channel]}
            </button>
          )
        })}
      </div>

    </div>
  )
}
