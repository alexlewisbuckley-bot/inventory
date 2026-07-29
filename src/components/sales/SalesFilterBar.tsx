'use client'
import { useListQuery } from '@/hooks/useListQuery'
import { ToolbarDate, ToolbarRow } from '@/components/ui'

/**
 * The date range, and only the date range.
 *
 * Search, channel, payment and delivery all moved to the shared filter bar in
 * E6 — this is what is left, and it stays a pair of date inputs rather than
 * becoming two more chips. A from/to range is the one filter a chip expresses
 * worse than a control: "Sold is after 1 March, and Sold is before 31 March"
 * is two chips saying what one range means, and the ledger is read by date
 * more often than by anything else.
 */
export function SalesFilterBar() {
  const query = useListQuery()

  return (
    <div className="mb-4">
      <ToolbarRow>
        <ToolbarDate
          label="From"
          value={query.get('from') ?? ''}
          onChange={(value) => query.set('from', value || null)}
        />
        <ToolbarDate
          label="to"
          value={query.get('to') ?? ''}
          onChange={(value) => query.set('to', value || null)}
        />
      </ToolbarRow>
    </div>
  )
}
