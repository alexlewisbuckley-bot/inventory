'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import {
  ArrowRight, Banknote, BarChart3, Briefcase, LifeBuoy, ListChecks, Package, Plus,
  Search, Settings, Store, Truck, UserRound, Users,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMounted } from '@/hooks/useMounted'
import { useFocusTrap, useScrollLock } from '@/hooks/useFocusTrap'
import { useDebounced } from '@/hooks/useDebounced'
import { Peek, type PeekKind, type PeekTarget } from '@/components/ui/Peek'

type Kind = 'watch' | 'contact' | 'supplier' | 'deal' | 'sale' | 'task'

interface Hit {
  kind: Kind
  id: string
  title: string
  subtitle: string
  meta: string | null
  href: string
  exact: boolean
}

interface Action {
  id: string
  label: string
  hint?: string
  href: string
  icon: typeof Package
  keywords: string
}

/**
 * The actions, addressed by typing rather than by remembering where they live.
 *
 * `keywords` is what makes "new" find "Add an item" and "wanted" find the
 * sourcing board. A palette that only matches the words on the button helps
 * only the people who already know the button exists.
 */
const ACTIONS: Action[] = [
  { id: 'add-watch', label: 'Add an item', hint: 'Log a purchase', href: '/inventory/new', icon: Plus, keywords: 'new stock buy intake purchase watch jewellery handbag' },
  { id: 'inventory', label: 'Stock', href: '/inventory', icon: Package, keywords: 'watches inventory list' },
  { id: 'deals', label: 'Deals', href: '/deals', icon: Briefcase, keywords: 'pipeline board opportunities' },
  { id: 'customers', label: 'Customers', href: '/customers', icon: Users, keywords: 'contacts people book crm' },
  { id: 'requests', label: 'Wanted', href: '/requests', icon: Search, keywords: 'wants sourcing demand requests' },
  { id: 'tasks', label: 'Tasks', href: '/tasks', icon: ListChecks, keywords: 'follow ups todo' },
  { id: 'sales', label: 'Sales', href: '/sales', icon: Truck, keywords: 'ledger invoices revenue' },
  { id: 'suppliers', label: 'Suppliers', href: '/suppliers', icon: Store, keywords: 'dealers sources trade' },
  { id: 'reports', label: 'Reports', href: '/reports', icon: Banknote, keywords: 'margin ageing analysis' },
  { id: 'insights', label: 'Insights', href: '/insights', icon: BarChart3, keywords: 'selling funnel win rate charts' },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings, keywords: 'preferences users currency admin' },
  { id: 'help', label: 'Help & shortcuts', href: '/help', icon: LifeBuoy, keywords: 'keyboard shortcuts guide support' },
]

const KIND_ICON: Record<Kind, typeof Package> = {
  watch: Package,
  contact: UserRound,
  supplier: Store,
  deal: Briefcase,
  sale: Truck,
  task: ListChecks,
}

const KIND_GROUP: Record<Kind, string> = {
  contact: 'Contacts',
  deal: 'Deals',
  watch: 'Watches',
  sale: 'Sales',
  supplier: 'Suppliers',
  task: 'Tasks',
}

/** The order groups appear in. People look for a person first. */
const GROUP_ORDER: Kind[] = ['contact', 'deal', 'watch', 'sale', 'supplier', 'task']

const PEEKABLE = new Set<Kind>(['watch', 'contact', 'deal'])

const RECENTS_KEY = '__bluecroftPaletteRecents'
const RECENTS_MAX = 5

/**
 * Command palette (⌘K).
 *
 * The primary navigation surface, and the whole reason the rail can shrink: if
 * four letters reach any record of any type, nothing needs a permanent link
 * for findability alone. (Audit C-3.)
 *
 * One input, three jobs, disambiguated by what is typed and never by a mode.
 * A leading `>` means actions only; everything else searches records and
 * actions together; empty shows what you were last looking at, then the five
 * things people do most — because the commonest use of a palette is returning
 * to the thing you had open ten minutes ago.
 *
 * Two details decide whether it feels fast. Results from the previous query
 * stay on screen, dimmed, while the next runs: a list that empties between
 * keystrokes reads as broken even when it is quicker. And `→` opens a peek
 * rather than navigating, so checking one fact does not cost you the page you
 * were on.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const panel = useRef<HTMLDivElement>(null)
  const mounted = useMounted()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [stale, setStale] = useState(false)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(0)
  const [peeking, setPeeking] = useState<PeekTarget | null>(null)
  const [recents, setRecents] = useState<Hit[]>([])
  const debounced = useDebounced(query, 160)

  useFocusTrap(panel, open && peeking === null, onClose)
  useScrollLock(open)

  useEffect(() => {
    if (open) return
    setQuery('')
    setHits([])
    setActive(0)
    setFailed(false)
    setPeeking(null)
  }, [open])

  // Recents live in memory for the session rather than in storage: browser
  // storage is unavailable to this application, and a list of records somebody
  // looked at should not outlive the tab on a shared machine anyway.
  useEffect(() => {
    if (!open) return
    const cached = (globalThis as Record<string, unknown>)[RECENTS_KEY] as Hit[] | undefined
    setRecents(cached ?? [])
  }, [open])

  const remember = useCallback((hit: Hit) => {
    const store = globalThis as Record<string, unknown>
    const previous = (store[RECENTS_KEY] as Hit[] | undefined) ?? []
    store[RECENTS_KEY] = [hit, ...previous.filter((item) => item.id !== hit.id)].slice(0, RECENTS_MAX)
  }, [])

  const actionsOnly = query.startsWith('>')
  const term = actionsOnly ? query.slice(1).trim() : query.trim()

  useEffect(() => {
    if (!open || actionsOnly) { setHits([]); return }
    const needle = debounced.trim()
    if (needle.length < 2) { setHits([]); setStale(false); return }

    let cancelled = false
    setStale(true)
    fetch(`/api/search?q=${encodeURIComponent(needle)}`)
      .then((response) => {
        if (!response.ok) throw new Error('unavailable')
        return response.json() as Promise<{ hits: Hit[] }>
      })
      .then((data) => {
        if (cancelled) return
        setHits(data.hits ?? [])
        setFailed(false)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setStale(false) })
    return () => { cancelled = true }
  }, [debounced, open, actionsOnly])

  const actions = useMemo(() => {
    const needle = term.toLowerCase()
    if (!needle) return ACTIONS.slice(0, 5)
    return ACTIONS.filter((action) =>
      action.label.toLowerCase().includes(needle) || action.keywords.includes(needle))
  }, [term])

  /**
   * One flat list, grouped only for display.
   *
   * Arrow keys move a single index through everything. Per-group indices are
   * how a keyboard user ends up pressing down and watching the highlight jump
   * backwards over a heading.
   */
  const rows = useMemo(() => {
    const out: Array<
      | { type: 'heading'; key: string; label: string }
      | { type: 'action'; key: string; data: Action }
      | { type: 'hit'; key: string; data: Hit }
    > = []

    if (term.length === 0 && !actionsOnly && recents.length > 0) {
      out.push({ type: 'heading', key: 'h-recent', label: 'Where you were' })
      for (const hit of recents) out.push({ type: 'hit', key: `r-${hit.id}`, data: hit })
    }

    if (!actionsOnly) {
      for (const kind of GROUP_ORDER) {
        const group = hits.filter((hit) => hit.kind === kind)
        if (group.length === 0) continue
        out.push({ type: 'heading', key: `h-${kind}`, label: KIND_GROUP[kind] })
        for (const hit of group) out.push({ type: 'hit', key: hit.id, data: hit })
      }
    }

    if (actions.length > 0) {
      out.push({ type: 'heading', key: 'h-actions', label: actionsOnly ? 'Actions' : 'Go to' })
      for (const action of actions) out.push({ type: 'action', key: action.id, data: action })
    }

    return out
  }, [hits, actions, recents, term, actionsOnly])

  const selectable = useMemo(
    () => rows.filter((row) => row.type !== 'heading') as Array<
      { type: 'action'; key: string; data: Action } | { type: 'hit'; key: string; data: Hit }
    >,
    [rows],
  )

  useEffect(() => { setActive(0) }, [selectable.length])

  const go = useCallback((href: string, newTab: boolean) => {
    if (newTab) { window.open(href, '_blank', 'noopener'); return }
    onClose()
    router.push(href)
  }, [onClose, router])

  const choose = useCallback((index: number, newTab = false) => {
    const row = selectable[index]
    if (!row) return
    if (row.type === 'hit') remember(row.data)
    go(row.data.href, newTab)
  }, [selectable, go, remember])

  const peekAt = useCallback((index: number) => {
    const row = selectable[index]
    if (!row || row.type !== 'hit' || !PEEKABLE.has(row.data.kind)) return
    setPeeking({ kind: row.data.kind as PeekKind, id: row.data.id })
  }, [selectable])

  if (!mounted || !open) return null

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, selectable.length - 1))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(active, event.metaKey || event.ctrlKey)
    }
    // Only when the caret is already at the end, or `→` stops being an arrow
    // key inside an input somebody is still editing.
    if (event.key === 'ArrowRight') {
      const input = event.target as HTMLInputElement
      if (input.selectionStart === input.value.length) {
        event.preventDefault()
        peekAt(active)
      }
    }
  }

  return (
    <>
      {createPortal(
        <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
          <div className="fixed inset-0 bg-navy-900/45 animate-fade-in" onClick={onClose} aria-hidden />
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label="Search and commands"
            className="relative z-10 w-full max-w-xl overflow-hidden rounded-lg bg-surface-overlay shadow-overlay animate-slide-up"
          >
            <div className="flex items-center gap-3 border-b border-line-subtle px-5">
              <Search className="h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
              <input
                data-autofocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Anyone, anything — a name, a number, a serial. Or > for actions."
                aria-label="Search"
                aria-controls="command-results"
                className="w-full bg-transparent py-4 text-body-lg text-content-primary outline-none placeholder:text-content-muted"
              />
            </div>

            <ul
              id="command-results"
              role="listbox"
              className={cn(
                'max-h-[420px] overflow-y-auto py-2 transition-opacity',
                // Dimmed rather than emptied. A list that blanks between
                // keystrokes reads as broken even when it is faster.
                stale && 'opacity-70',
              )}
            >
              {failed && (
                <li className="px-5 py-3 text-small text-state-danger" role="alert">
                  Search is unavailable. What you were looking at is still below.
                </li>
              )}

              {selectable.length === 0 && !failed && (
                <li className="px-5 py-8 text-center text-small text-content-secondary">
                  {term.length >= 2
                    ? <>Nothing matches “{term}”. Try a surname, a stock number, or part of a phone number.</>
                    : 'Type two letters to search everything, or > to run an action.'}
                </li>
              )}

              {rows.map((row) => {
                if (row.type === 'heading') {
                  return (
                    <li
                      key={row.key}
                      role="presentation"
                      className="px-5 pb-1 pt-3 text-micro font-semibold uppercase tracking-wide text-content-secondary"
                    >
                      {row.label}
                    </li>
                  )
                }

                const index = selectable.findIndex((item) => item.key === row.key)
                const selected = index === active
                const Icon = row.type === 'action' ? row.data.icon : KIND_ICON[row.data.kind]
                const canPeek = row.type === 'hit' && PEEKABLE.has(row.data.kind)

                return (
                  <li key={row.key} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(index)}
                      onClick={(event) => choose(index, event.metaKey || event.ctrlKey)}
                      className={cn(
                        'flex w-full items-center gap-3 px-5 py-2.5 text-left',
                        selected && 'bg-surface-subtle',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-content-primary">
                          {row.type === 'action' ? row.data.label : row.data.title}
                        </span>
                        <span className="block truncate text-caption text-content-secondary">
                          {row.type === 'action' ? row.data.hint ?? '' : row.data.subtitle}
                        </span>
                      </span>
                      {row.type === 'hit' && row.data.meta && (
                        <span className="shrink-0 text-small font-semibold tabular-nums text-content-secondary">
                          {row.data.meta}
                        </span>
                      )}
                      {selected && canPeek && (
                        <span className="shrink-0 text-micro text-content-secondary">→ peek</span>
                      )}
                      <ArrowRight
                        className={cn('h-4 w-4 shrink-0 text-content-secondary', !selected && 'opacity-0')}
                        aria-hidden
                      />
                    </button>
                  </li>
                )
              })}
            </ul>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-subtle px-5 py-2.5 text-micro text-content-secondary">
              <span><kbd className="font-sans font-semibold">↑↓</kbd> move</span>
              <span><kbd className="font-sans font-semibold">↵</kbd> open</span>
              <span><kbd className="font-sans font-semibold">⌘↵</kbd> new tab</span>
              <span><kbd className="font-sans font-semibold">→</kbd> peek</span>
              <span><kbd className="font-sans font-semibold">esc</kbd> close</span>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <Peek target={peeking} onClose={() => setPeeking(null)} />
    </>
  )
}
