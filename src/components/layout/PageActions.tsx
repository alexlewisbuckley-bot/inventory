'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { AnchoredMenu, type MenuItem } from '@/components/ui/AnchoredMenu'

export interface SecondaryAction {
  id: string
  label: string
  href: string
  icon?: ReactNode
}

/**
 * Secondary page actions, collapsed on small screens.
 *
 * A page header carrying three buttons wraps onto three lines on a phone, each
 * a different width, which buries the one action that matters. Below `sm` they
 * fold into an overflow menu and the primary action stands alone; above it,
 * nothing changes.
 */
export function PageActions({ secondary, primary }: {
  secondary: SecondaryAction[]
  primary?: ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const items: MenuItem[] = secondary.map((action) => ({
    id: action.id,
    label: action.label,
    icon: action.icon,
    onSelect: () => router.push(action.href),
  }))

  return (
    <>
      {secondary.length > 0 && (
        <>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="More actions"
            className="flex h-11 w-11 items-center justify-center rounded-pill border-[1.5px] border-navy-700 text-navy-700 transition-colors hover:bg-navy-700/5 sm:hidden"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
          <AnchoredMenu
            open={open}
            onClose={() => setOpen(false)}
            anchorRef={triggerRef}
            items={items}
            label="More actions"
          />
        </>
      )}
      {primary}
    </>
  )
}
