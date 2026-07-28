'use client'
import { useCallback, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * URL-backed list state.
 *
 * Search, filters, sort and page all live in the query string so a filtered
 * view is shareable, survives refresh, and works with browser back/forward.
 * `isPending` drives a subtle busy state while the server component refetches.
 */
export function useListQuery() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const push = useCallback((next: URLSearchParams) => {
    const query = next.toString()
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }, [pathname, router])

  /** Set or clear a single value, resetting to page 1. */
  const set = useCallback((key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (value === null || value === '') next.delete(key)
    else next.set(key, value)
    if (key !== 'page') next.delete('page')
    push(next)
  }, [params, push])

  /** Add or remove one value from a repeated (multi-select) key. */
  const toggle = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    const current = next.getAll(key)
    next.delete(key)
    const updated = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    updated.forEach((v) => next.append(key, v))
    next.delete('page')
    push(next)
  }, [params, push])

  /** Toggle sort direction, or switch field (defaulting to descending). */
  const sortBy = useCallback((field: string) => {
    const next = new URLSearchParams(params.toString())
    const currentField = next.get('sort')
    const currentDir = next.get('dir') ?? 'desc'
    next.set('sort', field)
    next.set('dir', currentField === field && currentDir === 'desc' ? 'asc' : 'desc')
    next.delete('page')
    push(next)
  }, [params, push])

  const clearAll = useCallback(() => push(new URLSearchParams()), [push])

  return {
    params,
    isPending,
    set,
    toggle,
    sortBy,
    clearAll,
    get: (key: string) => params.get(key),
    getAll: (key: string) => params.getAll(key),
    has: (key: string, value: string) => params.getAll(key).includes(value),
    /** Count of active filters, excluding sort and pagination. */
    activeFilterCount: [...params.keys()].filter(
      (k) => !['sort', 'dir', 'page', 'perPage', 'watch'].includes(k),
    ).length,
  }
}
