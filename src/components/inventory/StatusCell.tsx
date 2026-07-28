'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, Loader2, Undo2 } from 'lucide-react'
import { StatusChip, useToast } from '@/components/ui'
import { setStatusAction } from '@/app/actions/watches'
import { WATCH_STATUS_LABELS, type WatchStatus } from '@/lib/enums'
import { cn } from '@/lib/cn'

/**
 * Statuses reachable from where a watch is now.
 *
 * Mirrors STATUS_TRANSITIONS on the server. The server is the authority — it
 * rejects anything else — but repeating the map here means an impossible move
 * is never offered in the first place, which is a better experience than an
 * error toast explaining why the thing you just clicked was not allowed.
 *
 * Sold is absent everywhere on purpose: it requires an invoice and an amount,
 * so it is reached through "Mark as sold" and left by voiding the sale.
 */
const TRANSITIONS: Record<WatchStatus, WatchStatus[]> = {
  IN_STOCK: ['RESERVED', 'SALE_AGREED', 'WRITTEN_OFF'],
  RESERVED: ['IN_STOCK', 'SALE_AGREED', 'WRITTEN_OFF'],
  SALE_AGREED: ['IN_STOCK', 'RESERVED', 'WRITTEN_OFF'],
  SOLD: [],
  RETURNED: ['IN_STOCK', 'WRITTEN_OFF'],
  WRITTEN_OFF: ['IN_STOCK'],
}

/**
 * Status as a control rather than a label.
 *
 * The status of a watch changes constantly — reserved on a phone call, sale
 * agreed an hour later, back in stock when the buyer goes quiet — and every one
 * of those used to mean opening the edit form. It is now one click in the row.
 */
export function StatusCell({ watchId, status, editable, onSell, canSell, onVoid, canVoid }: {
  watchId: string
  status: WatchStatus
  editable: boolean
  canSell: boolean
  onSell: () => void
  canVoid: boolean
  onVoid: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const options = TRANSITIONS[status] ?? []
  const canSellFromHere = canSell && status !== 'SOLD'
  const canVoidFromHere = canVoid && status === 'SOLD'
  const hasMenu = editable && (options.length > 0 || canSellFromHere || canVoidFromHere)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    // Capture phase: the menu is portalled, so a click inside it is not a
    // descendant of the button and would otherwise close before it registered.
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!hasMenu) return <StatusChip status={status} />

  const toggle = () => {
    if (open) { setOpen(false); return }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      // Portalled to the body, so the menu is not clipped by the table's
      // horizontal scroller — inside it, the menu was cut off at the edge.
      setAnchor({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen(true)
  }

  const choose = async (next: WatchStatus) => {
    setOpen(false)
    setBusy(true)
    const result = await setStatusAction(watchId, next)
    setBusy(false)
    if (result.ok) {
      toast.success(result.message ?? 'Status updated')
      router.refresh()
    } else {
      toast.error('Could not change the status', result.message)
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Status: ${WATCH_STATUS_LABELS[status]}. Change it.`}
        className={cn('inline-flex items-center gap-1 rounded-pill transition-opacity', !busy && 'hover:opacity-80')}
      >
        <StatusChip status={status} />
        {busy
          ? <Loader2 className="h-3 w-3 animate-spin text-content-secondary" aria-hidden />
          : <ChevronDown className="h-3 w-3 text-content-secondary" aria-hidden />}
      </button>

      {open && anchor && createPortal(
        <div
          role="menu"
          style={{ top: anchor.top, left: anchor.left }}
          className="fixed z-50 min-w-[180px] overflow-hidden rounded-md border border-line-subtle bg-surface-raised py-1 shadow-overlay"
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitem"
              onClick={() => choose(option)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-small text-content-primary transition-colors hover:bg-surface-subtle"
            >
              <Check className="h-3.5 w-3.5 opacity-0" aria-hidden />
              {WATCH_STATUS_LABELS[option]}
            </button>
          ))}

          {canSellFromHere && (
            <>
              {options.length > 0 && <div className="my-1 h-px bg-line-subtle" role="separator" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onSell() }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-small font-bold text-content-accent transition-colors hover:bg-surface-subtle"
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
                Mark as sold…
              </button>
            </>
          )}

          {canVoidFromHere && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onVoid() }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-small font-bold text-state-danger transition-colors hover:bg-state-danger/8"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden />
              Void the sale…
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
