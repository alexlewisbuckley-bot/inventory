'use client'
import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useFocusTrap, useScrollLock } from '@/hooks/useFocusTrap'
import { useMounted } from '@/hooks/useMounted'
import { Button, IconButton } from './Button'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<ModalSize, string> = {
  sm: 'max-w-[420px]', md: 'max-w-[520px]', lg: 'max-w-[720px]', xl: 'max-w-[920px]',
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  size?: ModalSize
  children: ReactNode
  footer?: ReactNode
  /** Blocks backdrop-click dismissal — use for forms with unsaved input. */
  dismissible?: boolean
}

/**
 * Accessible dialog: focus trap, Escape to close, scroll lock, labelled by its
 * own title. Rendered in a portal so it escapes any ancestor stacking context.
 */
export function Modal({
  open, onClose, title, description, size = 'md', children, footer, dismissible = true,
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null)
  const mounted = useMounted()
  useFocusTrap(panel, open, onClose)
  useScrollLock(open)

  if (!mounted || !open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-navy-900/45 animate-fade-in"
        onClick={dismissible ? onClose : undefined}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'relative z-10 my-auto w-full rounded-lg bg-surface-overlay shadow-overlay animate-slide-up',
          SIZES[size],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line-subtle px-7 py-5">
          <div className="min-w-0">
            <h2 id="modal-title" className="text-h3 font-extrabold text-content-primary">{title}</h2>
            {description && <p className="mt-1 text-small text-content-secondary">{description}</p>}
          </div>
          <IconButton label="Close dialog" size="sm" onClick={onClose} icon={<X className="h-5 w-5" />} />
        </header>

        <div className="px-7 py-6">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-3 border-t border-line-subtle px-7 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

export interface ConfirmDialogProps {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  loading?: boolean
}

/** Confirmation for destructive or irreversible actions. */
export function ConfirmDialog({
  open, onCancel, onConfirm, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'danger', loading,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-body text-content-secondary">{message}</p>
    </Modal>
  )
}
