'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Theme } from '@/lib/enums'

interface ThemeContextValue {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'bluecroft.theme'

/**
 * Theme controller.
 *
 * `SYSTEM` follows `prefers-color-scheme` live. The choice is mirrored to
 * localStorage for instant application on the next load (see `themeScript`)
 * and persisted server-side through the preferences form.
 */
export function ThemeProvider({ children, initial = 'SYSTEM' }: { children: ReactNode; initial?: Theme }) {
  const [theme, setThemeState] = useState<Theme>(initial)
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(media.matches)
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null
    if (stored && stored !== theme) setThemeState(stored)
    // Intentionally runs once: later changes flow through setTheme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resolved: 'light' | 'dark' = theme === 'SYSTEM' ? (systemDark ? 'dark' : 'light') : theme === 'DARK' ? 'dark' : 'light'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    document.documentElement.style.colorScheme = resolved
  }, [resolved])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }, [])

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>.')
  return context
}

/**
 * Applied before paint to prevent a light-theme flash for dark-mode users.
 * Injected as a blocking inline script in the root layout.
 */
export const themeScript = `
(function(){try{
  var t = localStorage.getItem('bluecroft.theme') || 'SYSTEM';
  var dark = t === 'DARK' || (t === 'SYSTEM' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) { document.documentElement.classList.add('dark'); document.documentElement.style.colorScheme = 'dark'; }
}catch(e){}})();
`.trim()
