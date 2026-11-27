'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import {
  ArrowRight, Banknote, BarChart3, Briefcase, Camera, FileText, LifeBuoy, ListChecks, Package, Plus,
  Search, Settings, Store, Truck, UserRound, Users, ListFilter,
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
  /** A photograph for the row, where the kind has one. */
  imageId?: string | null
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
  { id: 'book-invoice', label: 'Book in from an invoice', hint: 'Drop a supplier PDF', href: '/inventory/invoice', icon: FileText, keywords: 'invoice pdf upload drop scan supplier intake bulk' },
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

/** The palette shows the best few of each kind; this is where the rest are. */
const PER_KIND = 5

const FULL_LIST: Partial<Record<Kind, { noun: string; hint: string; href: string }>> = {
  watch: { noun: 'watch', hint: 'The stock list, with photographs and filters', href: '/inventory' },
  sale: { noun: 'sale', hint: 'The sales ledger', href: '/sales' },
  contact: { noun: 'contact', hint: 'Customers', href: '/customers' },
  supplier: { noun: 'supplier', hint: 'Suppliers', href: '/suppliers' },
  deal: { noun: 'deal', hint: 'The deal board', href: '/deals' },
  task: { noun: 'task', hint: 'Tasks', href: '/tasks' },
}

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

        /*
         * A way out of the five.
         *
         * Alex: "can't see images or view all just can click 1 watch only."
         * The palette answers with the best few of each kind, which is the
         * right thing for a palette and a dead end when the answer is "there
         * are twenty of those" — and it gave no sign it had stopped at five.
         * A full group now offers the real list, which has the photographs,
         * the filters and the rest of the rows.
         *
         * Only where the group is full, because a group of three is all of
         * them and "see all three" sends somebody somewhere they already are.
         */
        const more = FULL_LIST[kind]
        if (more && group.length >= PER_KIND) {
          out.push({
            type: 'action',
            key: `more-${kind}`,
            data: {
              id: `more-${kind}`,
              label: `See every ${more.noun} matching “${term}”`,
              hint: more.hint,
              icon: ListFilter,
              href: `${more.href}?q=${encodeURIComponent(term)}`,
              // Never matched against: this row is built from a group that
              // already matched, not found by typing its own label.
              keywords: '',
            },
          })
        }
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
                      {/*
                        The photograph where there is one.

                        Alex, searching a reference on a phone: "can't see
                        images... hard to tell which watch it is the way it's
                        built." Five rows reading "Rolex 126500LN" are five
                        identical rows, and the picture separates a white dial
                        from a black one before the serial has been read.
                      */}
                      {row.type === 'hit' && row.data.imageId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/images/${row.data.imageId}`}
                          alt=""
                          loading="lazy"
                          className="h-10 w-10 shrink-0 rounded-xs object-cover"
                        />
                      ) : row.type === 'hit' && row.data.kind === 'watch' ? (
                        // Same footprint as a photograph, so a watch with no
                        // picture does not knock the column of them out of
                        // line — which reads as a different kind of row.
                        <span
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xs bg-surface-subtle"
                          aria-hidden
                        >
                          <Camera className="h-4 w-4 text-content-muted" />
                        </span>
                      ) : (
                        <Icon className="h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-content-primary">
                          {row.type === 'action' ? row.data.label : row.data.title}
                        </span>
                        {/*
                          Two lines on a narrow screen rather than one cut in
                          half. The subtitle is the serial, which is the whole
                          of what tells two of the same reference apart —
                          "Stock 1722 · seri…" identifies nothing.
                        */}
                        <span className="block text-caption text-content-secondary sm:truncate">
                          {row.type === 'action' ? row.data.hint ?? '' : row.data.subtitle}
                        </span>
                      </span>
                      {row.type === 'hit' && row.data.meta && (
                        <span className="shrink-0 text-small font-semibold tabular-nums text-content-secondary">
                          {row.data.meta}
                        </span>
                      )}
                      {/*
                        Hidden on touch: peek is bound to the right-arrow key,
                        and a hint about a key there is no keyboard for only
                        takes width from the serial.
                      */}
                      {selected && canPeek && (
                        <span className="hidden shrink-0 text-micro text-content-secondary sm:inline">→ peek</span>
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

            {/*
              Hidden on touch. Four keyboard shortcuts and an Esc on a phone
              are two lines of advice nobody there can take, and they were
              two lines taken off the results.
            */}
            <div className="hidden flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-subtle px-5 py-2.5 text-micro text-content-secondary sm:flex">
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
