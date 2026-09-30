'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { LayoutGrid, Rows3, Search, X } from 'lucide-react'
import { useListQuery } from '@/hooks/useListQuery'
import { cn } from '@/lib/cn'

const SORTS = [
  { value: 'brand', label: 'Brand, A–Z' },
  { value: 'trade-desc', label: 'Trade, high to low' },
  { value: 'trade-asc', label: 'Trade, low to high' },
  { value: 'year-desc', label: 'Year, newest' },
]

/**
 * The filters, in the bar.
 *
 * They used to sit in a card of their own under a page heading, which made
 * three stacked bands before a single watch appeared: a bar with the mark on
 * it, a title repeating what the one nav item already said, and a row of
 * controls. For an application with one page, that is two bands of furniture
 * and one of content.
 *
 * Rendered by the layout so the bar is the same object on every page, and
 * returns nothing anywhere but the catalogue — a search box for stock has no
 * business sitting above somebody's profile.
 */
export function CatalogueControls({ brands }: { brands: string[] }) {
  const pathname = usePathname()
  const query = useListQuery()

  const brand = query.get('brand') ?? ''
  const sort = query.get('sort') ?? 'brand'
  const q = query.get('q') ?? ''
  const quotedOnly = query.get('quotedOnly') === 'true'
  const view = query.get('view') === 'table' ? 'table' : 'gallery'
  const filtering = Boolean(brand || q || quotedOnly)

  const [text, setText] = useState(q)
  useEffect(() => { setText(q) }, [q])

  // After the hooks, never before: the bar renders on every page this role
  // can reach, so leaving early above a `useState` changes the hook count
  // between routes and React tears the tree down.
  if (pathname !== '/catalogue') return null

  const field = 'h-9 rounded-md border border-line-subtle bg-surface-raised px-2 text-body text-content-primary outline-none transition-colors focus:border-teal-500'

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
      <label className="relative min-w-[150px] flex-1 lg:max-w-[340px]">
        <span className="sr-only">Search the inventory</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" aria-hidden />
        {/* Held locally as well as in the URL: typing must not wait on a
            round trip, and Clear must be able to empty the box, which an
            uncontrolled input will not do. */}
        <input
          type="search"
          value={text}
          onChange={(event) => { setText(event.target.value); query.set('q', event.target.value || null) }}
          placeholder="Reference, model, dial, metal"
          className={cn(field, 'w-full pl-8')}
        />
      </label>

      <label className="shrink-0">
        <span className="sr-only">Brand</span>
        <select value={brand} onChange={(e) => query.set('brand', e.target.value || null)} className={field}>
          <option value="">All brands</option>
          {brands.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>

      <label className="shrink-0">
        <span className="sr-only">Order</span>
        <select value={sort} onChange={(e) => query.set('sort', e.target.value)} className={field}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>

      <label className="flex shrink-0 items-center gap-2 text-body text-content-secondary">
        <input
          type="checkbox"
          checked={quotedOnly}
          onChange={(e) => query.set('quotedOnly', e.target.checked ? 'true' : null)}
          className="h-4 w-4 accent-teal-600"
        />
        <span className="hidden xl:inline">Trade priced only</span>
        <span className="xl:hidden">Priced</span>
      </label>

      {filtering && (
        <button
          type="button"
          onClick={() => { setText(''); query.setMany({ q: null, brand: null, quotedOnly: null }) }}
          className="inline-flex shrink-0 items-center gap-1 text-caption text-content-secondary hover:text-content-primary"
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Clear
        </button>
      )}

      <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-line-subtle p-0.5" role="group" aria-label="View">
        <ViewButton active={view === 'gallery'} onClick={() => query.set('view', null)} icon={<LayoutGrid className="h-4 w-4" aria-hidden />} label="Gallery" />
        <ViewButton active={view === 'table'} onClick={() => query.set('view', 'table')} icon={<Rows3 className="h-4 w-4" aria-hidden />} label="Table" />
      </div>
    </div>
  )
}

function ViewButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`${label} view`}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-caption font-semibold transition-colors',
        active ? 'bg-surface-subtle text-content-primary' : 'text-content-secondary hover:text-content-primary',
      )}
    >
      {icon}
      <span className="hidden 2xl:inline">{label}</span>
    </button>
  )
}
