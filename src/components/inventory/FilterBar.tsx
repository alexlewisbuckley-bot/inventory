'use client'
import { useEffect, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useListQuery } from '@/hooks/useListQuery'
import { useDebounced } from '@/hooks/useDebounced'
import { Button, Chip, ToolbarRow, ToolbarSearch } from '@/components/ui'
import { WATCH_STATUSES, WATCH_STATUS_LABELS } from '@/lib/enums'

export interface FilterOption { id: string; name: string }

export interface FilterBarProps {
  locations: FilterOption[]
  suppliers: FilterOption[]
  brands: FilterOption[]
}

/**
 * Inventory filter toolbar.
 *
 * Search is debounced so typing does not fire a request per keystroke; every
 * other control writes straight to the URL via `useListQuery`.
 */
export function FilterBar({ locations, suppliers, brands }: FilterBarProps) {
  const query = useListQuery()
  const [term, setTerm] = useState(query.get('q') ?? '')
  const [advanced, setAdvanced] = useState(false)
  const debounced = useDebounced(term, 300)

  useEffect(() => {
    if (debounced !== (query.get('q') ?? '')) query.set('q', debounced || null)
    // Only react to the debounced term; query identity changes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const hasFilters = query.activeFilterCount > 0

  return (
    <div className="mb-6 flex flex-col gap-3">
      <ToolbarRow>
        <ToolbarSearch
          value={term}
          onChange={setTerm}
          label="Search inventory"
          placeholder="Search by stock number, reference or serial…"
        />

        <MultiSelect label="Status" name="status" options={WATCH_STATUSES.map((s) => ({ id: s, name: WATCH_STATUS_LABELS[s] }))} />
        <MultiSelect label="Location" name="locationId" options={locations} />
        <MultiSelect label="Supplier" name="supplierId" options={suppliers} />

        <Button
          variant="subtle"
          size="sm"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
          icon={<SlidersHorizontal className="h-4 w-4" />}
          className="h-11 rounded-md"
        >
          More filters
        </Button>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={query.clearAll} className="h-11 rounded-md">
            Clear all
          </Button>
        )}
      </ToolbarRow>

      {advanced && (
        // Every cell carries a label above a control of the same height, so the
        // row lines up. Previously the brand picker had its label inside the
        // control and the checkbox was bottom-aligned with a magic padding,
        // which left three different baselines across four columns.
        <div className="grid gap-4 rounded-md border border-line-subtle bg-surface-raised p-4 sm:grid-cols-2 lg:grid-cols-4">
          <FilterField label="Brand">
            <MultiSelect label="Brand" name="brandId" options={brands} block hideLabel />
          </FilterField>

          <FilterField label="Purchased from" htmlFor="filter-from">
            <input
              id="filter-from"
              type="date"
              defaultValue={query.get('purchasedFrom') ?? ''}
              onChange={(e) => query.set('purchasedFrom', e.target.value || null)}
              className={DATE_INPUT}
            />
          </FilterField>

          <FilterField label="Purchased to" htmlFor="filter-to">
            <input
              id="filter-to"
              type="date"
              defaultValue={query.get('purchasedTo') ?? ''}
              onChange={(e) => query.set('purchasedTo', e.target.value || null)}
              className={DATE_INPUT}
            />
          </FilterField>

          <FilterField label="Pricing">
            <label className="flex h-11 cursor-pointer items-center gap-2.5 rounded-md border border-line-subtle bg-surface-raised px-3.5 transition-colors hover:border-line-strong">
              <input
                type="checkbox"
                checked={query.get('unpricedOnly') === 'true'}
                onChange={(e) => query.set('unpricedOnly', e.target.checked ? 'true' : null)}
                className="h-4 w-4 rounded-xs accent-teal-500"
              />
              <span className="truncate text-small text-content-primary">Only watches with no price</span>
            </label>
          </FilterField>
        </div>
      )}

      {hasFilters && <ActiveFilterPills locations={locations} suppliers={suppliers} brands={brands} />}
    </div>
  )
}

const DATE_INPUT =
  'h-11 w-full rounded-md border border-line-subtle bg-surface-raised px-3.5 text-small text-content-primary ' +
  'transition-colors hover:border-line-strong'

/** A labelled cell in the advanced filter grid, so every column shares a baseline. */
function FilterField({ label, htmlFor, children }: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-caption font-semibold text-content-secondary">
        {label}
      </label>
      {children}
    </div>
  )
}

function MultiSelect({ label, name, options, block, hideLabel }: {
  label: string; name: string; options: FilterOption[]; block?: boolean; hideLabel?: boolean
}) {
  const query = useListQuery()
  const selected = query.getAll(name)
  const [open, setOpen] = useState(false)

  return (
    <div className={cn('relative', block && 'w-full')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex h-11 items-center gap-2 rounded-md border bg-surface-raised px-3.5 text-small transition-colors',
          selected.length > 0 ? 'border-teal-500 text-content-primary' : 'border-line-subtle text-content-secondary hover:border-line-strong',
          block && 'w-full justify-between',
        )}
      >
        {hideLabel ? <span className="sr-only">{label}</span> : <span>{label}:</span>}
        <span className="font-bold text-navy-700">
          {selected.length === 0 ? 'All' : selected.length === 1
            ? options.find((o) => o.id === selected[0])?.name ?? '1 selected'
            : `${selected.length} selected`}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-line-subtle bg-surface-raised p-1 shadow-raised">
            {options.length === 0 && <p className="px-3 py-2 text-small text-content-secondary">Nothing to filter by.</p>}
            {options.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-sm px-3 py-2 text-body hover:bg-surface-subtle"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option.id)}
                  onChange={() => query.toggle(name, option.id)}
                  className="h-4 w-4 rounded-xs accent-teal-500"
                />
                <span className="truncate text-content-primary">{option.name}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Removable chips summarising what is currently filtered. */
function ActiveFilterPills({ locations, suppliers, brands }: FilterBarProps) {
  const query = useListQuery()
  const lookup = (name: string, id: string): string => {
    const source = name === 'locationId' ? locations : name === 'supplierId' ? suppliers : brands
    return source.find((o) => o.id === id)?.name ?? id
  }

  const pills: Array<{ key: string; label: string; onRemove: () => void }> = []
  for (const name of ['status', 'locationId', 'supplierId', 'brandId']) {
    for (const value of query.getAll(name)) {
      pills.push({
        key: `${name}:${value}`,
        label: name === 'status'
          ? WATCH_STATUS_LABELS[value as keyof typeof WATCH_STATUS_LABELS] ?? value
          : lookup(name, value),
        onRemove: () => query.toggle(name, value),
      })
    }
  }
  if (query.get('unpricedOnly') === 'true') {
    pills.push({ key: 'unpriced', label: 'No price set', onRemove: () => query.set('unpricedOnly', null) })
  }
  if (pills.length === 0) return null

  return (
    <ul className="flex flex-wrap items-center gap-2">
      {pills.map((pill) => (
        <li key={pill.key}>
          <button
            type="button"
            onClick={pill.onRemove}
            className="group inline-flex items-center gap-1.5 rounded-pill bg-teal-100 px-3 py-1 text-caption font-semibold text-content-accent"
            aria-label={`Remove filter ${pill.label}`}
          >
            {pill.label}
            <X className="h-3 w-3 opacity-60 group-hover:opacity-100" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}
