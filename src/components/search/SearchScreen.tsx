'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Briefcase, ListChecks, Package, Search, Store, Truck, UserRound,
} from 'lucide-react'
import { useDebounced } from '@/hooks/useDebounced'
import { cn } from '@/lib/cn'

type Kind = 'watch' | 'contact' | 'supplier' | 'deal' | 'sale' | 'task'

interface Hit {
  kind: Kind
  id: string
  title: string
  subtitle: string
  meta: string | null
  href: string
}

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

const GROUP_ORDER: Kind[] = ['contact', 'deal', 'watch', 'sale', 'supplier', 'task']

/**
 * The palette's results, as a page.
 *
 * Everything behavioural is shared with the ⌘K palette — the endpoint, the
 * grouping, the keep-stale-results-dimmed rule — because two search surfaces
 * that rank differently teach people to distrust both. What differs is only
 * what must: rows are 44px+ for touch, results are links rather than
 * keyboard-driven options, and the input keeps focus on load because on a
 * phone this page *is* the search box.
 */
export function SearchScreen() {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [stale, setStale] = useState(false)
  const [failed, setFailed] = useState(false)
  const debounced = useDebounced(query, 200)

  useEffect(() => { input.current?.focus() }, [])

  useEffect(() => {
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
  }, [debounced])

  return (
    <div className="mx-auto max-w-2xl">
      <label className="relative block">
        <span className="sr-only">Search</span>
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-content-secondary"
          aria-hidden
        />
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type at least two letters…"
          inputMode="search"
          className="h-11 w-full rounded-md border border-line-subtle bg-surface-raised pl-11 pr-4 text-body text-content-primary transition-colors placeholder:text-content-muted hover:border-line-strong"
        />
      </label>

      <div className={cn('mt-4 transition-opacity', stale && 'opacity-70')}>
        {failed && (
          <p role="alert" className="rounded-md bg-state-critical/8 px-4 py-3 text-small text-state-critical">
            Search is unavailable. Try again in a moment.
          </p>
        )}

        {!failed && hits.length === 0 && debounced.trim().length >= 2 && !stale && (
          <p className="px-1 py-6 text-center text-small text-content-secondary">
            Nothing matches “{debounced.trim()}”. Try a surname, a stock number, or part
            of a phone number.
          </p>
        )}

        {GROUP_ORDER.map((kind) => {
          const group = hits.filter((hit) => hit.kind === kind)
          if (group.length === 0) return null
          const Icon = KIND_ICON[kind]
          return (
            <section key={kind} className="mb-4">
              <h2 className="px-1 pb-1 text-micro font-semibold uppercase tracking-wide text-content-secondary">
                {KIND_GROUP[kind]}
              </h2>
              <ul className="overflow-hidden rounded-lg border border-line-subtle bg-surface-raised">
                {group.map((hit) => (
                  <li key={hit.id} className="border-b border-line-subtle last:border-b-0">
                    <Link
                      href={hit.href}
                      className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-subtle"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-content-primary">
                          {hit.title}
                        </span>
                        <span className="block truncate text-caption text-content-secondary">
                          {hit.subtitle}
                        </span>
                      </span>
                      {hit.meta && (
                        <span className="shrink-0 text-small font-semibold tabular-nums text-content-secondary">
                          {hit.meta}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
