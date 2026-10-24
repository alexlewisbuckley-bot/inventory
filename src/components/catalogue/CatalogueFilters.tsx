'use client'
import { X } from 'lucide-react'
import { useListQuery } from '@/hooks/useListQuery'
import { cn } from '@/lib/cn'
import type { CatalogueFacets, FacetChoice } from '@/server/services/catalogue-service'

/**
 * The cuts a dealer makes, under the bar rather than in it.
 *
 * The top bar already carries search, brand, order and the view switch,
 * and eight more menus in that row would push it off the side of a laptop.
 * These sit above the grid instead, where they read as a property of the
 * list rather than of the application.
 *
 * Every menu is counted against the other filters but not its own, so
 * choosing Rolex narrows the dials while the brand menu still offers Patek
 * — otherwise picking one filter is a door that locks behind you.
 *
 * A menu with one choice is not shown. There is nothing to choose between,
 * and a row of single-option selects is furniture that makes the real
 * controls harder to find.
 */
const MENUS: Array<{ key: string; label: string; from: keyof CatalogueFacets }> = [
  { key: 'family', label: 'Model', from: 'families' },
  { key: 'wears', label: 'Worn by', from: 'wears' },
  { key: 'dial', label: 'Dial', from: 'dials' },
  { key: 'material', label: 'Metal', from: 'materials' },
  { key: 'size', label: 'Size', from: 'sizes' },
  { key: 'year', label: 'Year', from: 'years' },
  { key: 'condition', label: 'Condition', from: 'conditions' },
  { key: 'boxPapers', label: 'Box & papers', from: 'sets' },
]

export function CatalogueFilters({ facets }: { facets: CatalogueFacets }) {
  const query = useListQuery()
  const active = MENUS.filter((menu) => query.get(menu.key))
  const shown = MENUS.filter((menu) => facets[menu.from].length > 1 || query.get(menu.key))

  if (shown.length === 0) return null

  const clear = () => {
    query.setMany(Object.fromEntries(MENUS.map((menu) => [menu.key, null])))
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {shown.map((menu) => (
        <Menu
          key={menu.key}
          label={menu.label}
          value={query.get(menu.key) ?? ''}
          options={facets[menu.from]}
          onChange={(value) => query.set(menu.key, value || null)}
        />
      ))}

      {active.length > 0 && (
        <button
          type="button"
          onClick={clear}
          className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-caption text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Clear filters
        </button>
      )}
    </div>
  )
}

/**
 * One menu. The count rides on each option rather than the label, because
 * the question is "how many Daytonas", not "how many choices of model".
 */
function Menu({ label, value, options, onChange }: {
  label: string
  value: string
  options: FacetChoice[]
  onChange: (value: string) => void
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          // Capped, not content-sized. A select is as wide as its longest
          // option, and "Oystersteel and Everose gold" made the Metal menu
          // three times the width of Size — a ragged row on a laptop and
          // one that runs off the side of a phone. The same lesson the top
          // bar already learned with one long brand name.
          'h-9 w-[8.5rem] cursor-pointer appearance-none truncate rounded-md border bg-surface-raised pl-2.5 pr-7 text-caption outline-none transition-colors focus:border-teal-500',
          // A set filter says so without being read: the row can carry
          // eight menus and a glance has to find the two that are doing
          // something.
          value
            ? 'border-content-accent font-semibold text-content-primary'
            : 'border-line-subtle text-content-secondary',
        )}
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} ({option.count})
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-content-muted"
        viewBox="0 0 12 12" fill="none" aria-hidden
      >
        <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </label>
  )
}
