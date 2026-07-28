'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { ArrowRight, Package, Plus, Search, Settings, Store, Truck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMounted } from '@/hooks/useMounted'
import { useFocusTrap, useScrollLock } from '@/hooks/useFocusTrap'
import { useDebounced } from '@/hooks/useDebounced'
import { formatMoney } from '@/lib/money'

interface SearchHit {
  id: string
  stockNo: number
  label: string
  sublabel: string
  priceGbp: number
}

interface Command {
  id: string
  label: string
  hint?: string
  href: string
  icon: typeof Package
}

const COMMANDS: Command[] = [
  { id: 'inventory', label: 'Go to inventory', href: '/inventory', icon: Package },
  { id: 'add', label: 'Add a watch', hint: 'Log a new purchase', href: '/inventory/new', icon: Plus },
  { id: 'sales', label: 'Go to sales', href: '/sales', icon: Truck },
  { id: 'locations', label: 'Go to locations', href: '/locations', icon: Store },
  { id: 'settings', label: 'Open settings', href: '/settings', icon: Settings },
]

/**
 * Command palette (⌘K).
 *
 * Combines static navigation commands with a debounced server search over
 * stock. Arrow keys move a single highlighted index across the merged list so
 * keyboard flow never jumps between sections unexpectedly.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const panel = useRef<HTMLDivElement>(null)
  const mounted = useMounted()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const debounced = useDebounced(query, 200)

  useFocusTrap(panel, open, onClose)
  useScrollLock(open)

  useEffect(() => { if (!open) { setQuery(''); setHits([]); setActive(0) } }, [open])

  useEffect(() => {
    if (!open || debounced.trim().length < 2) { setHits([]); return }
    let cancelled = false
    setLoading(true)
    fetch(`/api/search?q=${encodeURIComponent(debounced)}`)
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((data: { results: SearchHit[] }) => { if (!cancelled) setHits(data.results ?? []) })
      .catch(() => { if (!cancelled) setHits([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debounced, open])

  const commands = useMemo(
    () => COMMANDS.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())),
    [query],
  )
  const items = useMemo(
    () => [
      ...commands.map((c) => ({ kind: 'command' as const, key: c.id, href: c.href, data: c })),
      ...hits.map((h) => ({ kind: 'hit' as const, key: h.id, href: `/inventory?watch=${h.id}`, data: h })),
    ],
    [commands, hits],
  )

  useEffect(() => { setActive(0) }, [items.length])

  if (!mounted || !open) return null

  const go = (href: string) => { onClose(); router.push(href) }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    if (event.key === 'Enter' && items[active]) { event.preventDefault(); go(items[active]!.href) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <div className="fixed inset-0 bg-navy-900/45 animate-fade-in" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-lg bg-surface-raised shadow-overlay animate-slide-up"
      >
        <div className="flex items-center gap-3 border-b border-line-subtle px-5">
          <Search className="h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
          <input
            data-autofocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search stock number, model or serial…"
            aria-label="Search"
            aria-controls="command-results"
            className="w-full bg-transparent py-4 text-body-lg text-content-primary outline-none placeholder:text-content-secondary"
          />
          {loading && <span className="text-caption text-content-secondary">Searching…</span>}
        </div>

        <ul id="command-results" role="listbox" className="max-h-[380px] overflow-y-auto py-2">
          {items.length === 0 && (
            <li className="px-5 py-8 text-center text-small text-content-secondary">
              {query.length >= 2 ? `Nothing matches “${query}”.` : 'Type to search stock, or pick an action.'}
            </li>
          )}

          {items.map((item, index) => (
            <li key={item.key} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => go(item.href)}
                className={cn(
                  'flex w-full items-center gap-3 px-5 py-3 text-left',
                  index === active && 'bg-surface-subtle',
                )}
              >
                {item.kind === 'command' ? (
                  <>
                    <item.data.icon className="h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
                    <span className="flex-1">
                      <span className="block text-body font-medium text-content-primary">{item.data.label}</span>
                      {item.data.hint && <span className="block text-caption text-content-secondary">{item.data.hint}</span>}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-subtle text-micro font-bold text-navy-700">
                      {item.data.stockNo}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-body font-medium text-content-primary">{item.data.label}</span>
                      <span className="block truncate text-caption text-content-secondary">{item.data.sublabel}</span>
                    </span>
                    <span className="shrink-0 text-small font-bold tabular-nums text-content-primary">
                      {formatMoney(item.data.priceGbp, 'GBP')}
                    </span>
                  </>
                )}
                <ArrowRight className={cn('h-4 w-4 shrink-0 text-content-secondary', index !== active && 'opacity-0')} aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-4 border-t border-line-subtle px-5 py-2.5 text-micro text-content-secondary">
          <span><kbd className="font-sans font-semibold">↑↓</kbd> navigate</span>
          <span><kbd className="font-sans font-semibold">↵</kbd> open</span>
          <span><kbd className="font-sans font-semibold">esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
