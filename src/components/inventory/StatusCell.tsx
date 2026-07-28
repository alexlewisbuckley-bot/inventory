'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Loader2, Receipt, Undo2 } from 'lucide-react'
import { AnchoredMenu, StatusChip, useToast, type MenuItem } from '@/components/ui'
import { setStatusAction } from '@/app/actions/watches'
import { WATCH_STATUS_LABELS, type WatchStatus } from '@/lib/enums'
import { cn } from '@/lib/cn'

/**
 * Statuses reachable from where a watch is now.
 *
 * Mirrors STATUS_TRANSITIONS on the server. The server is the authority — it
 * rejects anything else — but repeating the map here means an impossible move
 * is never offered in the first place, which is better than an error toast
 * explaining why the thing you just clicked was not allowed.
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
 * of those used to mean opening the edit form. It is one click in the row.
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
  const buttonRef = useRef<HTMLButtonElement>(null)

  const transitions = TRANSITIONS[status] ?? []
  const canSellFromHere = canSell && status !== 'SOLD'
  const canVoidFromHere = canVoid && status === 'SOLD'

  const change = async (next: WatchStatus) => {
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

  const items: MenuItem[] = [
    ...transitions.map((option) => ({
      id: option,
      label: WATCH_STATUS_LABELS[option],
      onSelect: () => { void change(option) },
    })),
    ...(canSellFromHere ? [{
      id: 'sell',
      label: 'Mark as sold…',
      onSelect: onSell,
      icon: <Receipt className="h-3.5 w-3.5" />,
      tone: 'accent' as const,
      separated: transitions.length > 0,
    }] : []),
    ...(canVoidFromHere ? [{
      id: 'void',
      label: 'Void the sale…',
      onSelect: onVoid,
      icon: <Undo2 className="h-3.5 w-3.5" />,
      tone: 'danger' as const,
    }] : []),
  ]

  if (!editable || items.length === 0) return <StatusChip status={status} />

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
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

      <AnchoredMenu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        items={items}
        label={`Change status, currently ${WATCH_STATUS_LABELS[status]}`}
      />
    </>
  )
}
