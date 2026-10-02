'use client'
import { useMemo, useState } from 'react'
import { Camera, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { rankCandidates } from '@/lib/photo-match'
import type { PickerWatch } from './WatchPicker'

/**
 * Stock, as somewhere to put photographs.
 *
 * The rail exists because assigning a photograph was a per-row dropdown, and
 * a dropdown answers one question — which watch? — exactly once. Real stock
 * does not work that way: three of one reference is ordinary, a photograph of
 * the model belongs on all three, and twenty photographs belong to the same
 * watch. Both of those are a drag away here, and nothing about them needs the
 * list to be reopened forty times.
 *
 * Dragging is never the only way. Every row has a button that does the same
 * thing to whatever is selected, so the whole page works from the keyboard
 * and on a trackpad somebody is tired of.
 */
export function StockRail({
  watches, counts, targeted, selectionCount, dragging, onAssign, className,
}: {
  watches: PickerWatch[]
  /** Photographs in this batch already going to each watch. */
  counts: Map<string, number>
  /** Watches every selected photograph already goes to. */
  targeted: Set<string>
  selectionCount: number
  /** A photograph is being dragged right now. */
  dragging: boolean
  onAssign: (watchId: string) => void
  className?: string
}) {
  const [query, setQuery] = useState('')
  const [over, setOver] = useState<string | null>(null)

  const shown = useMemo(() => {
    const term = query.trim()
    if (!term) return watches
    const ranked = rankCandidates(term, watches, 60).map((r) => r.candidate)
    const seen = new Set(ranked.map((w) => w.id))
    const plain = watches.filter((w) => !seen.has(w.id) && text(w).includes(term.toLowerCase()))
    return [...ranked, ...plain]
  }, [query, watches])

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-sm border border-line-subtle bg-surface-raised', className)}>
      <div className="shrink-0 border-b border-line-subtle px-4 py-3">
        <p className="text-caption font-semibold uppercase tracking-[0.14em] text-content-muted">Stock</p>
        <p className="mt-1 text-caption text-content-secondary">
          {selectionCount > 0
            ? `Drag the ${selectionCount} selected here, or press ＋`
            : 'Drag a photograph onto a watch'}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-line-subtle px-3">
        <Search className="h-4 w-4 shrink-0 text-content-muted" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Reference, name, stock number…"
          aria-label="Search stock"
          className="w-full bg-transparent py-2.5 text-small text-content-primary outline-none placeholder:text-content-muted"
        />
      </div>

      <ul className="flex-1 overflow-y-auto">
        {shown.map((watch) => {
          const held = counts.get(watch.id) ?? 0
          const isOver = over === watch.id
          return (
            <li key={watch.id}>
              <div
                onDragOver={(e) => { e.preventDefault(); setOver(watch.id) }}
                onDragLeave={() => setOver((current) => (current === watch.id ? null : current))}
                onDrop={(e) => { e.preventDefault(); setOver(null); onAssign(watch.id) }}
                className={cn(
                  'flex items-center gap-2 border-t border-line-subtle px-3 py-2 transition-colors first:border-t-0',
                  isOver && 'bg-teal-100/60 ring-1 ring-inset ring-teal-500',
                  !isOver && dragging && 'bg-surface-subtle/60',
                  !isOver && !dragging && targeted.has(watch.id) && 'bg-surface-subtle',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-small text-content-primary">
                    <span className="tabular-nums text-content-secondary">{watch.stockNo}</span>
                    {' · '}
                    {watch.brandName} <span className="font-semibold">{watch.reference}</span>
                  </p>
                  <p className="truncate text-caption text-content-secondary">
                    {[watch.nickname, watch.serial].filter(Boolean).join(' · ') || 'No name or serial recorded'}
                  </p>
                </div>

                {watch.photographs > 0 && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 text-caption tabular-nums text-content-muted"
                    title={`${watch.photographs} already on this watch`}
                  >
                    <Camera className="h-3 w-3" aria-hidden />
                    {watch.photographs}
                  </span>
                )}
                {held > 0 && (
                  <span className="shrink-0 rounded-full bg-teal-500 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                    +{held}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => onAssign(watch.id)}
                  disabled={selectionCount === 0}
                  title={selectionCount === 0
                    ? 'Select a photograph first'
                    : `Assign the ${selectionCount} selected to this watch`}
                  aria-label={`Assign selected photographs to stock ${watch.stockNo}`}
                  className="shrink-0 rounded-sm border border-line-subtle p-1 text-content-secondary hover:border-teal-500 hover:text-content-accent disabled:cursor-default disabled:opacity-30 disabled:hover:border-line-subtle disabled:hover:text-content-secondary"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </li>
          )
        })}
        {shown.length === 0 && (
          <li className="px-3 py-4 text-small text-content-secondary">Nothing in stock matches that.</li>
        )}
      </ul>
    </div>
  )
}

function text(watch: PickerWatch): string {
  return [watch.stockNo, watch.brandName, watch.reference, watch.nickname, watch.serial]
    .filter(Boolean).join(' ').toLowerCase()
}
