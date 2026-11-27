'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useDebounced } from '@/hooks/useDebounced'
import { cn } from '@/lib/cn'

/**
 * The controls above a list, folded up on a phone.
 *
 * Alex: "This whole search and filtering on mobile is awful and takes up so
 * much space - doesn't feel like a web app feels likes a clunky old tool."
 *
 * He was right and it was measurable: 1,361 pixels of chrome before the first
 * watch, which on a 390-wide phone is one and a half screens of scrolling to
 * reach the thing the page is for. The view chips wrapped onto four rows, the
 * facet pills onto three, and all of it was permanently open because the
 * desktop layout had simply been allowed to wrap.
 *
 * None of those controls is wrong — on a wide screen they are one glanceable
 * row each and they stay exactly as they were. What is wrong is showing all
 * of them, all the time, on a screen that cannot hold them. So on a phone
 * there is a search box and a button that says how many filters are on, and
 * everything else is behind it.
 *
 * The button carries the count because a filter you cannot see is a filter
 * you forget you set, and "198 watches" with no visible reason is how
 * somebody concludes the stock has gone missing.
 */
export function ListControls({ search, children }: {
  /** Placeholder for the phone's own search box. */
  search: string
  /** The real controls: views, filters, facets. Untouched on a wide screen. */
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [open, setOpen] = useState(false)

  const [term, setTerm] = useState(params.get('q') ?? '')
  const debounced = useDebounced(term, 300)

  /*
   * How many constraints are on, so the button can say so.
   *
   * Everything in the URL that narrows the list, which is every parameter
   * except the ones that arrange it. Counted from the URL rather than passed
   * down, because the URL is what the list is actually filtered by and a
   * number computed anywhere else can disagree with it.
   */
  const active = useMemo(() => {
    const arranging = new Set(['sort', 'dir', 'page', 'perPage', 'cols', 'q'])
    let total = 0
    for (const [key, value] of params.entries()) {
      if (arranging.has(key) || !value) continue
      // The filter parameter packs its clauses into one value, pipe-separated.
      total += key === 'f' ? value.split(',').length : 1
    }
    return total
  }, [params])

  const write = (next: URLSearchParams) => {
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  /*
   * The same contract the full filter bar uses, so the two cannot disagree:
   * the URL is the state and both of them only ever read and write it.
   *
   * In an effect, not in the render. Written there first, which navigates
   * while React is still rendering — the kind of thing that works until it
   * loops.
   */
  useEffect(() => {
    const current = params.get('q') ?? ''
    if (debounced === current) return
    const next = new URLSearchParams(params.toString())
    if (debounced) next.set('q', debounced)
    else next.delete('q')
    next.delete('page')
    write(next)
    // Only the debounced term drives this; `params` changes identity per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  // Somebody else changed the URL — a saved view, the back button.
  useEffect(() => {
    const current = params.get('q') ?? ''
    setTerm((existing) => (existing === debounced ? current : existing))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('q')])

  return (
    <>
      {/* ------------------------------------------------ phone and tablet */}
      {/*
        Pinned under the header, because searching should never mean
        scrolling back.
        Alex: "Filter and search on inventory should be sticky when
        scrolling." Forty rows down a stock list, the control that narrows
        it was four hundred pixels above the fold — so the way to search was
        to scroll to the top, search, and lose your place in the list.

        Sixty pixels down, which is the header's own height: it is `top-0`
        and would otherwise sit on top of this. Below the header's z-30 so
        that a menu opening out of the header still covers this bar rather
        than being covered by it. The negative margin and padding let the
        background reach the gutters, so rows pass underneath it rather than
        beside it.
      */}
      <div className="sticky top-[60px] z-20 -mx-4 mb-4 flex flex-col gap-2 border-b border-line-subtle bg-surface-subtle px-4 pb-2 pt-2 sm:-mx-5 sm:px-5 lg:hidden">
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{search}</span>
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-secondary"
              aria-hidden
            />
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={search}
              inputMode="search"
              className="h-11 w-full rounded-md border border-line-subtle bg-surface-raised pl-10 pr-9 text-body text-content-primary transition-colors placeholder:text-content-muted hover:border-line-strong"
            />
            {term && (
              <button
                type="button"
                onClick={() => setTerm('')}
                aria-label="Clear the search"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-content-secondary"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </label>

          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            className={cn(
              'flex h-11 shrink-0 items-center gap-2 rounded-md border px-3.5 text-small font-semibold transition-colors',
              active > 0
                ? 'border-navy-700 bg-navy-700 text-white'
                : 'border-line-subtle bg-surface-raised text-content-primary',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            {open ? 'Done' : 'Filters'}
            {active > 0 && (
              <span className="rounded-full bg-white/20 px-1.5 text-micro tabular-nums">{active}</span>
            )}
          </button>
        </div>

      </div>

      {/*
        The controls themselves, rendered once.

        Hidden rather than unmounted, and never duplicated: these are the
        same components the wide screen uses, and two copies of them would
        be two filter bars both writing the query string.
      */}
      <div
        className={cn(
          'rounded-md border border-line-subtle bg-surface-raised p-3 lg:block lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0',
          open ? 'mb-4 block' : 'hidden',
        )}
      >
        {children}
      </div>
    </>
  )
}
