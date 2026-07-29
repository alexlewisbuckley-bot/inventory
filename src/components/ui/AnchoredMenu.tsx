'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

export interface MenuItem {
  id: string
  label: string
  onSelect: () => void
  icon?: ReactNode
  tone?: 'default' | 'accent' | 'danger'
  /** Render a rule above this item. */
  separated?: boolean
}

/**
 * Whether choosing an item dismisses the menu.
 *
 * A menu of commands should close — the command has been given. A menu of
 * checkboxes should not: closing after each tick makes selecting three
 * statuses cost three round trips through the trigger, which is how a
 * multi-select filter ends up being used to select one thing.
 */
export type MenuDismissal = 'on-select' | 'stay-open'

const TONES: Record<NonNullable<MenuItem['tone']>, string> = {
  default: 'text-content-primary hover:bg-surface-subtle',
  accent: 'font-bold text-content-accent hover:bg-surface-subtle',
  danger: 'font-bold text-state-danger hover:bg-state-danger/8',
}

/**
 * A menu anchored to a trigger, rendered outside the layout.
 *
 * It has to be portalled: inside a table it was clipped by the horizontal
 * scroller and cut off at the edge of the visible columns. Portalling brings
 * three problems that have to be solved together, and the first two are why
 * the previous version of this looked right and did nothing:
 *
 * 1. A dismiss handler that only asks "was the click inside the trigger?"
 *    answers no for the menu itself, because the menu is no longer a
 *    descendant of the trigger. It closed on mousedown, React unmounted the
 *    item, and the click never landed on anything. The menu opened, looked
 *    correct, and every option was dead. Containment is therefore checked
 *    against the menu as well.
 *
 * 2. A fixed position calculated once at open time does not follow the row it
 *    belongs to. Scrolling left the menu floating over unrelated rows. It now
 *    closes on scroll rather than chasing the trigger: a menu that slides
 *    around under the cursor is worse than one that gets out of the way, and
 *    a row menu is a decision taken in a second, not something you scroll
 *    with. Resizing repositions, because that is a layout change rather than
 *    an intention to move on.
 *
 * 3. Near the bottom of a window the menu ran off-screen, so it flips above
 *    the trigger when there is not room below.
 */
export function AnchoredMenu({ open, onClose, anchorRef, items, label, dismiss = 'on-select' }: {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement>
  items: MenuItem[]
  label: string
  dismiss?: MenuDismissal
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  /** Where the trigger sat when the menu was placed, to detect real scrolling. */
  const anchoredAt = useRef(0)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [active, setActive] = useState(0)

  const reposition = useCallback(() => {
    const trigger = anchorRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()

    const height = menuRef.current?.offsetHeight ?? 0
    const width = menuRef.current?.offsetWidth ?? 200
    const spaceBelow = window.innerHeight - rect.bottom

    const top = height > 0 && spaceBelow < height + 8
      ? Math.max(8, rect.top - height - 4)
      : rect.bottom + 4

    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))
    anchoredAt.current = rect.top
    setPosition({ top, left })
  }, [anchorRef, onClose])

  // Measured before paint, so the menu never appears in the wrong place first.
  useLayoutEffect(() => {
    if (open) { setActive(0); reposition() }
    else setPosition(null)
  }, [open, reposition])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); anchorRef.current?.focus(); return }
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => (i + 1) % items.length); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => (i - 1 + items.length) % items.length); return }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        items[active]?.onSelect()
        if (dismiss === 'on-select') onClose()
      }
    }

    /**
     * Dismiss on scroll — but only real scrolling.
     *
     * Focusing a control can nudge a container by a pixel, and losing the menu
     * to that is maddening. Closing is keyed on the trigger having actually
     * moved, not on a scroll event having fired. Scrolling inside the menu
     * itself is never a dismissal.
     */
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return
      const top = anchorRef.current?.getBoundingClientRect().top
      if (top === undefined || Math.abs(top - anchoredAt.current) < 6) return
      onClose()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // Capture, because the scroller is an ancestor and scroll does not bubble.
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', reposition)

    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, onClose, reposition, anchorRef, items, active])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        // Hidden rather than unmounted until measured: the height is needed to
        // decide whether it flips, and it cannot be measured unrendered.
        visibility: position ? 'visible' : 'hidden',
      }}
      className="fixed z-[70] min-w-[190px] overflow-hidden rounded-md border border-line-subtle bg-surface-raised py-1 shadow-overlay"
    >
      {items.map((item, index) => (
        <div key={item.id}>
          {item.separated && <div className="my-1 h-px bg-line-subtle" role="separator" />}
          <button
            type="button"
            role="menuitem"
            data-menu-item={item.id}
            onMouseEnter={() => setActive(index)}
            onClick={() => { item.onSelect(); if (dismiss === 'on-select') onClose() }}
            className={cn(
              'flex w-full items-center gap-2.5 px-3 py-2 text-left text-small transition-colors',
              TONES[item.tone ?? 'default'],
              index === active && 'bg-surface-subtle',
            )}
          >
            {item.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>{item.icon}</span>}
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
