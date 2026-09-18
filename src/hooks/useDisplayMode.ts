'use client'
import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export const DISPLAY_MODES = ['table', 'gallery'] as const
export type DisplayMode = (typeof DISPLAY_MODES)[number]

const STORAGE_KEY = 'bluecroft.inventory.display'

const isMode = (value: unknown): value is DisplayMode =>
  typeof value === 'string' && (DISPLAY_MODES as readonly string[]).includes(value)

/**
 * Which way the stock list is drawn.
 *
 * Kept in the URL so a link shows what the sender was looking at and a saved
 * view remembers it, and mirrored to localStorage so somebody who works in
 * the gallery all day is not put back in the table every morning.
 *
 * Two rules, and the asymmetry between them is deliberate. The URL wins while
 * it says anything: an explicit link should not be overridden by whatever the
 * recipient happened to choose last week. But only pressing the control writes
 * the preference — following somebody else's gallery link shows you their
 * gallery without quietly making it your default for every visit after.
 *
 * The stored preference is applied after mount rather than during render:
 * reading localStorage while rendering makes the server and the client
 * disagree about the first paint, which React reports as a hydration error and
 * a person sees as a flicker.
 */
export function useDisplayMode(): { mode: DisplayMode; setMode: (mode: DisplayMode) => void } {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const fromUrl = params.get('display')
  const urlMode = isMode(fromUrl) ? fromUrl : null
  const [stored, setStored] = useState<DisplayMode | null>(null)

  useEffect(() => {
    if (urlMode) return
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (isMode(saved)) setStored(saved)
    } catch { /* private browsing */ }
  }, [urlMode])

  const mode: DisplayMode = urlMode ?? stored ?? 'table'

  const setMode = useCallback((next: DisplayMode) => {
    try { window.localStorage.setItem(STORAGE_KEY, next) } catch { /* private browsing */ }
    setStored(next)

    const query = new URLSearchParams(params.toString())
    // The table is the default, so it is spelled by the absence of the
    // parameter rather than by naming it — which keeps the everyday URL clean
    // and keeps a saved view from pinning a choice nobody made deliberately.
    if (next === 'table') query.delete('display')
    else query.set('display', next)
    const qs = query.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [params, pathname, router])

  return { mode, setMode }
}
