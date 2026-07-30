'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Loader2, X } from 'lucide-react'
import { useMounted } from '@/hooks/useMounted'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { Button, IconButton } from './Button'

export type PeekKind = 'watch' | 'contact' | 'deal'

export interface PeekRecord {
  kind: PeekKind
  id: string
  title: string
  subtitle: string
  href: string
  facts: Array<{ label: string; value: string }>
  recent: Array<{ label: string; at: string }>
}

export interface PeekTarget { kind: PeekKind; id: string }

/**
 * The event a row fires to ask for a peek.
 *
 * A custom event rather than a callback threaded through every table: peek has
 * to work from a stock row, a contact row, a deal card and a palette result,
 * and passing an `onPeek` down four component trees would put the same prop on
 * thirty components that have nothing else in common. One host listens; any
 * row can ask.
 */
export const PEEK_EVENT = 'bluecroft:peek'

export function requestPeek(target: PeekTarget): void {
  window.dispatchEvent(new CustomEvent<PeekTarget>(PEEK_EVENT, { detail: target }))
}

/**
 * A record, without going to it.
 *
 * This is the answer to the phone ringing mid-task. Somebody asks about stock
 * 1147 while you are halfway through entering a purchase; navigating away
 * loses the form, and opening a second tab loses the thread. A peek shows the
 * six facts and the last three things that happened, and `Esc` puts you back
 * exactly where you were — same scroll position, same focused control, same
 * half-finished form.
 *
 * Deliberately not the record. A peek that showed everything would be a slower
 * way to navigate; the value is entirely in being quicker to dismiss than the
 * record is to load. "Open the record" is one keystroke away for when it is
 * not enough.
 *
 * No scroll lock. That is not an oversight — locking the body is what makes a
 * modal feel like it took the page away, and this one is explicitly meant to
 * feel borrowed.
 */
export function Peek({ target, onClose }: {
  target: PeekTarget | null
  onClose: () => void
}) {
  const router = useRouter()
  const panel = useRef<HTMLDivElement>(null)
  const mounted = useMounted()
  const [record, setRecord] = useState<PeekRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Where focus was before the peek opened. Restored on close, because the
  // whole promise of this overlay is that dismissing it costs nothing.
  const returnFocusTo = useRef<HTMLElement | null>(null)

  useFocusTrap(panel, target !== null, onClose)

  useEffect(() => {
    if (target) {
      returnFocusTo.current = document.activeElement as HTMLElement
      return
    }
    const previous = returnFocusTo.current
    returnFocusTo.current = null
    // After the overlay has actually gone, or the browser puts focus back on
    // an element that is still being removed.
    if (previous) requestAnimationFrame(() => previous.focus?.())
  }, [target])

  useEffect(() => {
    if (!target) { setRecord(null); setError(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/peek?kind=${target.kind}&id=${encodeURIComponent(target.id)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? 'You cannot see that.' : 'Could not load that.')
        return response.json() as Promise<{ record: PeekRecord }>
      })
      .then((data) => { if (!cancelled) setRecord(data.record) })
      .catch((cause: Error) => { if (!cancelled) setError(cause.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [target])

  const open = useCallback(() => {
    if (!record) return
    onClose()
    router.push(record.href)
  }, [record, onClose, router])

  if (!mounted || !target) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-end p-4 sm:p-6">
      <div className="absolute inset-0 bg-navy-900/25 animate-fade-in" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={record ? `Preview of ${record.title}` : 'Preview'}
        className="relative z-10 flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-lg bg-surface-overlay shadow-overlay animate-slide-up"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-h3 font-extrabold text-content-primary">
              {record?.title ?? (loading ? 'Loading…' : 'Preview')}
            </p>
            {record && (
              <p className="mt-0.5 truncate text-caption text-content-secondary">{record.subtitle}</p>
            )}
          </div>
          <IconButton
            label="Close preview"
            icon={<X className="h-4 w-4" />}
            size="sm"
            onClick={onClose}
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && !record && (
            <p className="flex items-center gap-2 px-5 py-8 text-small text-content-secondary">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Fetching it…
            </p>
          )}

          {error && (
            <p role="alert" className="px-5 py-8 text-small text-state-danger">{error}</p>
          )}

          {record && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4">
                {record.facts.map((fact) => (
                  <div key={fact.label}>
                    <dt className="text-caption text-content-secondary">{fact.label}</dt>
                    <dd className="text-small font-semibold tabular-nums text-content-primary">
                      {fact.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="border-t border-line-subtle px-5 py-4">
                <p className="text-caption font-semibold text-content-secondary">Lately</p>
                {record.recent.length === 0 ? (
                  <p className="mt-1 text-small text-content-muted">Nothing logged against it.</p>
                ) : (
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {record.recent.map((entry, index) => (
                      <li key={index} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-small text-content-primary">
                          {entry.label}
                        </span>
                        <span className="shrink-0 text-caption tabular-nums text-content-secondary">
                          {new Date(entry.at).toLocaleDateString('en-GB')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line-subtle px-5 py-3">
          <span className="text-micro text-content-secondary">
            <kbd className="font-sans font-semibold">esc</kbd> back to what you were doing
          </span>
          <Button
            size="sm"
            iconRight={<ArrowUpRight className="h-4 w-4" />}
            disabled={!record}
            onClick={open}
          >
            Open
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The single peek overlay for the application.
 *
 * Mounted once in the app shell and opened by any row anywhere. Mounting one
 * per table would mean four overlays racing to trap focus the moment two
 * tables were on screen together.
 */
export function PeekHost() {
  const [target, setTarget] = useState<PeekTarget | null>(null)

  useEffect(() => {
    const onPeek = (event: Event) => setTarget((event as CustomEvent<PeekTarget>).detail)
    window.addEventListener(PEEK_EVENT, onPeek)
    return () => window.removeEventListener(PEEK_EVENT, onPeek)
  }, [])

  return <Peek target={target} onClose={() => setTarget(null)} />
}
