'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ChevronDown, LayoutGrid, Rows3, Search, X } from 'lucide-react'
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
 * Rendered by the layout so the bar is the same object on every page — twice,
 * in fact: inside the pinned bar at xl, and in a band under it below that, so
 * a phone does not carry the filters down the page. Each copy reads and
 * writes the same URL, so they never disagree. It
 * returns nothing anywhere but the catalogue — a search box for stock has no
 * business sitting above somebody's profile.
 */
export function CatalogueControls({ brands, className }: { brands: string[]; className?: string }) {
  const pathname = usePathname()
  const query = useListQuery()

  const brand = query.get('brand') ?? ''
  const sort = query.get('sort') ?? 'brand'
  const q = query.get('q') ?? ''
  const view = query.get('view') === 'table' ? 'table' : 'gallery'
  const filtering = Boolean(brand || q)

  const [text, setText] = useState(q)
  useEffect(() => { setText(q) }, [q])

  // After the hooks, never before: the bar renders on every page this role
  // can reach, so leaving early above a `useState` changes the hook count
  // between routes and React tears the tree down.
  if (pathname !== '/catalogue') return null

  const clear = () => { setText(''); query.setMany({ q: null, brand: null }) }

  // 16px on a phone and a tablet, not 14: iOS zooms the whole page into any
  // field set smaller than 16px the moment it is tapped, and leaves it
  // zoomed and panned sideways after the keyboard goes. 40px tall there too,
  // which is a target a thumb can hit; the desktop bar keeps its 36px.
  const field = 'h-10 w-full min-w-0 rounded-md border border-line-subtle bg-surface-raised px-2.5 text-body-lg text-content-primary outline-none transition-colors focus:border-teal-500 md:h-9 md:px-2 md:text-body'
  // The platform's own arrow: a heavy grey wedge that is a different shape
  // and a different weight on every operating system, and matches nothing
  // else on the bar. Suppressed, and the application's chevron drawn over
  // the top — the same one every other select in the app carries.
  //
  // Each select has a set width rather than its content's. A select is as
  // wide as its longest option, so one long brand name in the stock pushed
  // the whole bar off the side of a phone.
  const selectField = cn(field, 'cursor-pointer appearance-none truncate pr-7 md:pr-9')

  return (
    // Below md this is two rows — the search across the full width, then
    // brand, order and the view switch sharing the row under it. From md the
    // wrapper dissolves (`contents`) and everything sits on one line.
    <div className={cn('flex w-full min-w-0 flex-col gap-2 md:flex-row md:items-center md:gap-3 xl:w-auto xl:flex-1', className)}>
      <label className="relative min-w-0 md:flex-1 xl:max-w-[340px]">
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
          // `md:pl-8` because the field's own `md:px-2` would otherwise take
          // the left side back from the icon at that width.
          className={cn(field, 'pl-8 md:pl-8')}
        />
      </label>

      <div className="flex min-w-0 items-center gap-2 md:contents">
        <label className="relative min-w-0 flex-1 md:w-48 md:flex-none">
          <span className="sr-only">Brand</span>
          <select value={brand} onChange={(e) => query.set('brand', e.target.value || null)} className={selectField}>
            <option value="">All brands</option>
            {brands.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <Chevron />
        </label>

        <label className="relative min-w-0 flex-1 md:w-44 md:flex-none">
          <span className="sr-only">Order</span>
          <select value={sort} onChange={(e) => query.set('sort', e.target.value)} className={selectField}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <Chevron />
        </label>

        {filtering && (
          <button
            type="button"
            onClick={clear}
            className="hidden h-9 shrink-0 items-center gap-1 rounded-md px-1.5 text-caption text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary md:inline-flex"
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Clear
          </button>
        )}

        <div
          className="flex h-10 shrink-0 items-stretch gap-0.5 rounded-md border border-line-subtle p-0.5 md:h-9"
          role="group"
          aria-label="View"
        >
          <ViewButton active={view === 'gallery'} onClick={() => query.set('view', null)} icon={<LayoutGrid className="h-4 w-4" aria-hidden />} label="Gallery" />
          <ViewButton active={view === 'table'} onClick={() => query.set('view', 'table')} icon={<Rows3 className="h-4 w-4" aria-hidden />} label="Table" />
        </div>
      </div>

      {/* On a phone, its own line under the selects rather than a fourth
          thing squeezed in beside them: there it cost the brand name its
          last half. Only there while something is filtered. */}
      {filtering && (
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1.5 self-start py-1 text-small text-content-secondary hover:text-content-primary md:hidden"
        >
          <X className="h-4 w-4" aria-hidden /> Clear filters
        </button>
      )}
    </div>
  )
}

function Chevron() {
  return (
    <ChevronDown
      className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-content-secondary md:right-3"
      aria-hidden
    />
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
        'inline-flex items-center gap-1.5 rounded-sm px-1.5 text-caption font-semibold transition-colors sm:px-2',
        active ? 'bg-surface-subtle text-content-primary' : 'text-content-secondary hover:text-content-primary',
      )}
    >
      {icon}
      <span className="hidden 2xl:inline">{label}</span>
    </button>
  )
}
