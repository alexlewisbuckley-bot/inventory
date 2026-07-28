'use client'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Clock, Coins, Layers, Package, Receipt } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { LucideIcon } from 'lucide-react'

interface SavedView {
  id: string
  label: string
  icon: LucideIcon
  /** Query the view applies. An empty object means "everything". */
  params: Record<string, string | string[]>
  description: string
  tone?: 'attention'
}

/**
 * Saved views.
 *
 * Operators run the same handful of queries every morning — what is unpriced,
 * what has been sitting too long, what is agreed but not yet paid for. Each of
 * those was three or four dropdown interactions to rebuild. These are the
 * queries themselves, one click each, and because they write to the URL they
 * compose with search and sorting rather than replacing them.
 */
const VIEWS: SavedView[] = [
  {
    id: 'all', label: 'All stock', icon: Layers, params: {},
    description: 'Everything, including sold',
  },
  {
    id: 'in-stock', label: 'In stock', icon: Package,
    params: { status: ['IN_STOCK', 'RESERVED'] },
    description: 'Held and available',
  },
  {
    id: 'unpriced', label: 'Needs a price', icon: Coins,
    params: { unpricedOnly: 'true', status: ['IN_STOCK', 'RESERVED'] },
    description: 'Invisible to margin forecasting until priced',
    tone: 'attention',
  },
  {
    id: 'agreed', label: 'Sale agreed', icon: Receipt,
    params: { status: ['SALE_AGREED'] },
    description: 'Committed but not yet completed',
  },
  {
    id: 'ageing', label: 'Ageing', icon: Clock,
    params: { status: ['IN_STOCK', 'RESERVED'], sort: 'purchaseDate', dir: 'asc' },
    description: 'Oldest holdings first',
  },
  {
    id: 'sold', label: 'Sold', icon: AlertTriangle,
    params: { status: ['SOLD'] },
    description: 'Completed sales',
  },
]

export function SavedViews({ counts }: { counts?: Partial<Record<string, number>> }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const apply = (view: SavedView) => {
    const next = new URLSearchParams()
    // Search is preserved across views: switching segment should not discard
    // what the user was looking for.
    const q = params.get('q')
    if (q) next.set('q', q)
    for (const [key, value] of Object.entries(view.params)) {
      if (Array.isArray(value)) value.forEach((v) => next.append(key, v))
      else next.set(key, value)
    }
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  /** A view is active when every parameter it sets is currently present. */
  const isActive = (view: SavedView): boolean => {
    const statuses = params.getAll('status')
    const unpriced = params.get('unpricedOnly') === 'true'
    const hasAnyFilter = statuses.length > 0 || unpriced

    if (view.id === 'all') return !hasAnyFilter
    if (view.id === 'unpriced') return unpriced
    if (unpriced) return false

    const wanted = (view.params.status as string[] | undefined) ?? []
    if (wanted.length === 0) return false
    if (wanted.length !== statuses.length) return false
    if (!wanted.every((status) => statuses.includes(status))) return false
    if (view.id === 'ageing') return params.get('sort') === 'purchaseDate' && params.get('dir') === 'asc'
    if (view.id === 'in-stock') return params.get('sort') !== 'purchaseDate' || params.get('dir') !== 'asc'
    return true
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Saved views">
      {VIEWS.map((view) => {
        const active = isActive(view)
        const Icon = view.icon
        const count = counts?.[view.id]
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => apply(view)}
            aria-pressed={active}
            title={view.description}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-2 text-small font-semibold transition-colors',
              active
                ? 'bg-navy-700 text-white'
                : 'text-content-secondary hover:bg-surface-subtle hover:text-content-primary',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {view.label}
            {count !== undefined && count > 0 && (
              <span
                className={cn(
                  'rounded-pill px-1.5 text-micro font-bold tabular-nums',
                  active
                    ? 'bg-white/20 text-white'
                    : view.tone === 'attention'
                      ? 'bg-state-gold/20 text-state-gold'
                      : 'bg-surface-subtle text-content-secondary',
                )}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
