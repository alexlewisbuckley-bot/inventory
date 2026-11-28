'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Theme } from '@/lib/enums'

interface ThemeContextValue {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/*
 * Version two of the key, deliberately.
 *
 * Alex: "Please update to light mode only mine is showing black I don't
 * like it being black or at least have light as default and dark mode as a
 * selection." Every browser that has ever loaded this holds the string
 * "SYSTEM" under the old key — not because anybody chose it, but because it
 * was the default and the provider wrote it down. Changing the default
 * alone would have reached nobody who had already visited, which is
 * everybody. A new key starts them all at light; anyone who wants dark
 * picks it once and keeps it.
 */
const STORAGE_KEY = 'bluecroft.theme.v2'

/**
 * Theme controller.
 *
 * Light unless somebody says otherwise. `SYSTEM` is still on offer and
 * still follows `prefers-color-scheme` live — it is just no longer what
 * you get for never having chosen. The brand is ivory and sage, and a
 * dealer showing a customer a watch should not be handed a black screen
 * because their phone is in night mode.
 *
 * The choice is mirrored to localStorage for instant application on the
 * next load (see `themeScript`) and persisted server-side through the
 * preferences form.
 */
export function ThemeProvider({ children, initial = 'LIGHT' }: { children: ReactNode; initial?: Theme }) {
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
 * Applied before paint to prevent a flash of the wrong theme. Injected as a
 * blocking inline script in the root layout.
 *
 * It states the light case as well as the dark one. Leaving `colorScheme`
 * unset let the operating system style the parts of the page it owns — the
 * scrollbars, the date picker, the inside of a select — in dark, on a light
 * page, which is where a light theme on a dark phone looks broken rather
 * than light.
 *
 * The key is the versioned one; the default it falls back to is light.
 */
export const themeScript = `
(function(){try{
  var t = localStorage.getItem('bluecroft.theme.v2') || 'LIGHT';
  var dark = t === 'DARK' || (t === 'SYSTEM' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
}catch(e){}})();
`.trim()
