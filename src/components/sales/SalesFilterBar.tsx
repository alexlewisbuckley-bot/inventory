'use client'
import { useListQuery } from '@/hooks/useListQuery'
import { ToolbarDate, ToolbarRow } from '@/components/ui'
import { DATE_PRESETS, matchPreset, presetRange } from '@/lib/date-presets'
import { cn } from '@/lib/cn'

/**
 * The date range, and only the date range.
 *
 * Search, channel, payment and delivery all moved to the shared filter bar in
 * E6 — this is what is left, and it stays a pair of date inputs rather than
 * becoming two more chips. A from/to range is the one filter a chip expresses
 * worse than a control: "Sold is after 1 March, and Sold is before 31 March"
 * is two chips saying what one range means, and the ledger is read by date
 * more often than by anything else.
 *
 * The presets (this month, YTD and so on) just fill in both dates in one URL
 * write, so the inputs always show the exact days being reported on.
 */
export function SalesFilterBar() {
  const query = useListQuery()
  const from = query.get('from') ?? ''
  const to = query.get('to') ?? ''
  const active = matchPreset(from, to)
  const hasRange = Boolean(from || to)

  const presetClass = (on: boolean) => cn(
    'h-9 rounded-md border px-3 text-small transition-colors',
    on
      ? 'border-teal-500 bg-surface-raised font-bold text-content-primary'
      : 'border-line-subtle bg-surface-raised text-content-secondary hover:border-line-strong hover:text-content-primary',
  )

  return (
    <div className="mb-4 space-y-2.5">
      <ToolbarRow>
        <ToolbarDate
          label="From"
          value={from}
          onChange={(value) => query.set('from', value || null)}
        />
        <ToolbarDate
          label="to"
          value={to}
          onChange={(value) => query.set('to', value || null)}
        />
      </ToolbarRow>
      <ToolbarRow className="gap-2">
        <button
          type="button"
          aria-pressed={!hasRange}
          onClick={() => query.setMany({ from: null, to: null })}
          className={presetClass(!hasRange)}
        >
          All time
        </button>
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            aria-pressed={active === preset.key}
            onClick={() => query.setMany({ ...presetRange(preset.key) })}
            className={presetClass(active === preset.key)}
          >
            {preset.label}
          </button>
        ))}
      </ToolbarRow>
    </div>
  )
}
