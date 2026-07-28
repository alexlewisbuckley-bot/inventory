'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useMounted } from '@/hooks/useMounted'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useRef } from 'react'

/** Sequences are two-key: press `g`, then the destination. */
const GO_TO: Record<string, string> = {
  d: '/',
  i: '/inventory',
  s: '/sales',
  u: '/suppliers',
  l: '/locations',
  r: '/reports',
  n: '/notifications',
}

const SHORTCUTS: Array<{ keys: string[]; action: string; group: string }> = [
  { keys: ['⌘', 'K'], action: 'Search stock and jump anywhere', group: 'General' },
  { keys: ['/'], action: 'Focus the search box on this page', group: 'General' },
  { keys: ['?'], action: 'Show this list', group: 'General' },
  { keys: ['['], action: 'Collapse or expand the sidebar', group: 'General' },
  { keys: ['Esc'], action: 'Close any dialog, drawer or menu', group: 'General' },
  { keys: ['N'], action: 'Add a watch', group: 'Actions' },
  { keys: ['G', 'D'], action: 'Go to dashboard', group: 'Navigation' },
  { keys: ['G', 'I'], action: 'Go to inventory', group: 'Navigation' },
  { keys: ['G', 'S'], action: 'Go to sales', group: 'Navigation' },
  { keys: ['G', 'U'], action: 'Go to suppliers', group: 'Navigation' },
  { keys: ['G', 'L'], action: 'Go to locations', group: 'Navigation' },
  { keys: ['G', 'R'], action: 'Go to reports', group: 'Navigation' },
]

/**
 * Global keyboard layer.
 *
 * Operational staff repeat the same few journeys all day, and reaching for the
 * mouse to change section is the single most repeated wasted motion in a tool
 * like this. Shortcuts are deliberately the ones people already know from
 * GitHub, Linear and Gmail — `g` then a letter to navigate, `/` to search,
 * `?` for help — so there is nothing new to learn.
 *
 * Every handler bails out inside form fields, so typing "n" in a notes box
 * never navigates away.
 */
export function KeyboardShortcuts({ canCreate }: { canCreate: boolean }) {
  const router = useRouter()
  const [helpOpen, setHelpOpen] = useState(false)
  const [pendingGo, setPendingGo] = useState(false)
  const mounted = useMounted()
  const panel = useRef<HTMLDivElement>(null)
  useFocusTrap(panel, helpOpen, () => setHelpOpen(false))

  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null
      if (!element) return false
      return /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || element.isContentEditable
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target)) return

      const key = event.key.toLowerCase()

      // Second key of a `g` sequence.
      if (pendingGo) {
        setPendingGo(false)
        const destination = GO_TO[key]
        if (destination) {
          event.preventDefault()
          router.push(destination)
        }
        return
      }

      if (key === 'g') { setPendingGo(true); return }

      if (key === '?') {
        event.preventDefault()
        setHelpOpen((v) => !v)
        return
      }

      if (key === '/') {
        // Prefer a search box on the current page; fall back to the palette.
        const search = document.querySelector<HTMLInputElement>('input[aria-label="Search inventory"], input[aria-label="Search sales"]')
        if (search) {
          event.preventDefault()
          search.focus()
          search.select()
        }
        return
      }

      if (key === 'n' && canCreate) {
        event.preventDefault()
        router.push('/inventory/new')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [router, pendingGo, canCreate])

  // A half-finished `g` sequence should not linger.
  useEffect(() => {
    if (!pendingGo) return
    const timer = setTimeout(() => setPendingGo(false), 1500)
    return () => clearTimeout(timer)
  }, [pendingGo])

  if (!mounted) return null

  return (
    <>
      {pendingGo && createPortal(
        <div className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2 rounded-md border border-line-subtle bg-surface-raised px-3.5 py-2 text-caption text-content-secondary shadow-raised">
          <kbd className="font-sans font-bold text-content-primary">g</kbd> — press d, i, s, u, l, r or n
        </div>,
        document.body,
      )}

      {helpOpen && createPortal(
        <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[10vh]">
          <div className="fixed inset-0 bg-navy-900/45 animate-fade-in" onClick={() => setHelpOpen(false)} aria-hidden />
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            className="relative z-10 w-full max-w-lg overflow-hidden rounded-lg bg-surface-raised shadow-overlay animate-slide-up"
          >
            <header className="flex items-center justify-between border-b border-line-subtle px-6 py-4">
              <h2 id="shortcuts-title" className="text-h3 font-extrabold text-content-primary">Keyboard shortcuts</h2>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                aria-label="Close"
                data-autofocus
                className="rounded-sm p-1 text-content-secondary hover:text-content-primary"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </header>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              {['General', 'Navigation', 'Actions'].map((group) => (
                <section key={group} className="mb-5 last:mb-0">
                  <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-content-secondary">{group}</h3>
                  <ul className="flex flex-col gap-1.5">
                    {SHORTCUTS.filter((s) => s.group === group).map((shortcut) => (
                      <li key={shortcut.action} className="flex items-center justify-between gap-4">
                        <span className="text-body text-content-primary">{shortcut.action}</span>
                        <span className="flex shrink-0 gap-1">
                          {shortcut.keys.map((key) => (
                            <kbd key={key} className="rounded-[4px] border border-line-subtle bg-surface-subtle px-1.5 py-0.5 font-sans text-caption font-semibold text-content-secondary">
                              {key}
                            </kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
