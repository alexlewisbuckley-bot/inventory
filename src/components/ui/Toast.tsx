'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMounted } from '@/hooks/useMounted'

export type ToastTone = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  tone: ToastTone
  title: string
  description?: string
  /** Optional single action, e.g. "Undo". */
  action?: { label: string; onClick: () => void }
  duration?: number
}

interface ToastContextValue {
  toast: (t: Omit<Toast, 'id'>) => string
  success: (title: string, description?: string) => string
  error: (title: string, description?: string) => string
  info: (title: string, description?: string) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const ICONS: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-state-success" aria-hidden />,
  error: <XCircle className="h-5 w-5 text-state-danger" aria-hidden />,
  warning: <AlertTriangle className="h-5 w-5 text-state-gold" aria-hidden />,
  info: <Info className="h-5 w-5 text-navy-500" aria-hidden />,
}

/**
 * Toast host.
 *
 * Messages render into an `aria-live` region so screen readers announce them
 * without stealing focus. Errors default to a longer dwell time and warnings
 * never auto-dismiss when they carry an action the user must decide on.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const mounted = useMounted()

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) { clearTimeout(timer); timers.current.delete(id) }
  }, [])

  const toast = useCallback((input: Omit<Toast, 'id'>): string => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const duration = input.duration ?? (input.tone === 'error' ? 8000 : 5000)
    setToasts((current) => [...current.slice(-3), { ...input, id }])
    if (duration > 0) {
      timers.current.set(id, setTimeout(() => dismiss(id), duration))
    }
    return id
  }, [dismiss])

  useEffect(() => {
    const map = timers.current
    return () => { map.forEach(clearTimeout); map.clear() }
  }, [])

  const value = useMemo<ToastContextValue>(() => ({
    toast,
    dismiss,
    success: (title, description) => toast({ tone: 'success', title, description }),
    error: (title, description) => toast({ tone: 'error', title, description }),
    info: (title, description) => toast({ tone: 'info', title, description }),
  }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted && createPortal(
        <div
          role="region"
          aria-label="Notifications"
          className="pointer-events-none fixed bottom-0 right-0 z-[60] flex w-full max-w-sm flex-col gap-3 p-4"
        >
          <div aria-live="polite" aria-atomic="false" className="contents">
            {toasts.map((t) => (
              <div
                key={t.id}
                role={t.tone === 'error' ? 'alert' : 'status'}
                className={cn(
                  'pointer-events-auto flex items-start gap-3 rounded-md border bg-surface-raised p-4 shadow-raised animate-slide-up',
                  t.tone === 'error' ? 'border-state-danger/30' : 'border-line-subtle',
                )}
              >
                <span className="mt-0.5 shrink-0">{ICONS[t.tone]}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-bold text-content-primary">{t.title}</p>
                  {t.description && <p className="mt-0.5 text-caption text-content-secondary">{t.description}</p>}
                  {t.action && (
                    <button
                      type="button"
                      onClick={() => { t.action!.onClick(); dismiss(t.id) }}
                      className="mt-2 text-caption font-bold text-content-accent hover:underline"
                    >
                      {t.action.label}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                  className="shrink-0 rounded-sm p-0.5 text-content-secondary hover:text-content-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>.')
  return context
}
