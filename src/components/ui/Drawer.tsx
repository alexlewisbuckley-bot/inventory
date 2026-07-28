'use client'
import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useFocusTrap, useScrollLock } from '@/hooks/useFocusTrap'
import { useMounted } from '@/hooks/useMounted'
import { IconButton } from './Button'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  eyebrow?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: 'md' | 'lg'
}

/**
 * Right-hand slide-over panel for record detail.
 *
 * Chosen over a full page for the watch record so the user keeps their place in
 * the list — scroll position, filters and selection all survive.
 */
export function Drawer({ open, onClose, title, eyebrow, subtitle, children, footer, width = 'md' }: DrawerProps) {
  const panel = useRef<HTMLDivElement>(null)
  const mounted = useMounted()
  useFocusTrap(panel, open, onClose)
  useScrollLock(open)

  if (!mounted || !open) return null

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-navy-900/45 animate-fade-in" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className={cn(
          'absolute right-0 top-0 flex h-full w-full flex-col bg-surface-raised shadow-drawer animate-slide-in-right',
          width === 'lg' ? 'sm:w-[560px]' : 'sm:w-[480px]',
        )}
      >
        <header className="flex items-start justify-between gap-4 px-7 pt-7 pb-5">
          <div className="min-w-0">
            {eyebrow && <div className="mb-2 flex items-center gap-2">{eyebrow}</div>}
            <h2 id="drawer-title" className="text-h2 font-extrabold text-content-primary truncate">{title}</h2>
            {subtitle && <p className="mt-1 text-small text-content-secondary">{subtitle}</p>}
          </div>
          <IconButton label="Close panel" size="sm" onClick={onClose} icon={<X className="h-5 w-5" />} />
        </header>

        <div className="flex-1 overflow-y-auto px-7 pb-7">{children}</div>

        {footer && (
          <footer className="border-t border-line-subtle px-7 py-4">{footer}</footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
