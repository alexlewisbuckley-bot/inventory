'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown } from 'lucide-react'
import { AnchoredMenu, Chip, useToast } from '@/components/ui'
import { setRequestStatusAction } from '@/app/actions/crm'
import {
  REQUEST_STATUSES, REQUEST_STATUS_LABELS, type RequestStatus,
} from '@/lib/enums'
import { REQUEST_STATUS_TONE } from '@/lib/tokens'
import { cn } from '@/lib/cn'

/**
 * Moving a want along.
 *
 * The status was written by the matcher and readable on the card, and there
 * was no way for a person to change it — so a want fulfilled by a phone call
 * stayed "Open" forever, and the sourcing board slowly filled with things
 * nobody was sourcing. A board you have learned to distrust is worse than no
 * board, because it still costs a glance.
 *
 * Optimistic, because the correction is cheap: the chip changes immediately
 * and reverts with a message if the server disagrees.
 */
export function RequestStatusControl({ id, status, canUpdate }: {
  id: string
  status: RequestStatus
  canUpdate: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [current, setCurrent] = useState<RequestStatus>(status)

  const chip = (value: RequestStatus) => (
    <Chip tone={REQUEST_STATUS_TONE[value]}>
      {REQUEST_STATUS_LABELS[value]}
    </Chip>
  )

  if (!canUpdate) return chip(current)

  const move = (next: RequestStatus) => {
    setOpen(false)
    if (next === current) return
    const previous = current
    setCurrent(next)
    start(async () => {
      const result = await setRequestStatusAction(id, next)
      if (!result.ok) {
        setCurrent(previous)
        toast.error('Could not update the request', result.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Status: ${REQUEST_STATUS_LABELS[current]}. Change it.`}
        className={cn(
          'inline-flex items-center gap-1 rounded-pill transition-opacity hover:opacity-80',
          pending && 'opacity-70',
        )}
      >
        {chip(current)}
        <ChevronDown className="h-3.5 w-3.5 text-content-secondary" aria-hidden />
      </button>

      <AnchoredMenu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={trigger}
        label="Request status"
        items={REQUEST_STATUSES.map((value) => ({
          id: value,
          label: REQUEST_STATUS_LABELS[value],
          icon: value === current ? <Check className="h-4 w-4" aria-hidden /> : undefined,
          tone: value === current ? ('accent' as const) : ('default' as const),
          onSelect: () => move(value),
        }))}
      />
    </>
  )
}
