'use client'
import { useCallback, useEffect, useState } from 'react'

/**
 * Per-user column visibility, persisted in localStorage.
 *
 * Kept client-side deliberately: this is a view preference, not business data,
 * and writing it to the database would cost a round trip on every toggle for
 * something that is inherently per-device. Reading happens after mount so the
 * server and client render the same markup.
 */
export function useColumnPreferences(storageKey: string, allColumns: readonly string[], defaultHidden: readonly string[] = []) {
  const [hidden, setHidden] = useState<Set<string>>(new Set(defaultHidden))
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored) as string[]
        // Drop keys for columns that no longer exist, so a renamed column
        // cannot stay invisibly hidden forever.
        setHidden(new Set(parsed.filter((key) => allColumns.includes(key))))
      }
    } catch {
      // A corrupt value should not break the table.
    }
    setLoaded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const persist = useCallback((next: Set<string>) => {
    setHidden(next)
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...next]))
    } catch {
      // Private browsing or a full quota — the toggle still works this session.
    }
  }, [storageKey])

  const toggle = useCallback((key: string) => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try { window.localStorage.setItem(storageKey, JSON.stringify([...next])) } catch { /* noop */ }
      return next
    })
  }, [storageKey])

  const reset = useCallback(() => persist(new Set(defaultHidden)), [persist, defaultHidden])

  return {
    /** True until localStorage has been read; render the default set meanwhile. */
    loaded,
    isHidden: useCallback((key: string) => hidden.has(key), [hidden]),
    hiddenCount: hidden.size,
    toggle,
    reset,
    showAll: useCallback(() => persist(new Set()), [persist]),
  }
}
