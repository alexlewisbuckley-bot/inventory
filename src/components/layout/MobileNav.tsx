'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { flattenNav, isActive, navGroups, type SidebarCounts } from './nav-model'
import type { Role } from '@/lib/enums'

/**
 * Navigation for screens too narrow for the sidebar.
 *
 * A sheet rather than the scrolling tab strip this replaces. The strip could
 * only show the destinations that happened to fit, hid the rest behind a
 * horizontal scroll nobody discovers, and had no room for the counts that make
 * "Needs attention" useful. The sheet shows the same structure as the sidebar,
 * counts included, and closes on navigation, Escape or a tap outside.
 */
export function MobileNav({ role, counts }: { role: Role; counts: SidebarCounts }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { setMounted(true) }, [])

  const groups = navGroups(role, counts)
  const allItems = flattenNav(groups)
  const current = allItems.find((item) => isActive(item, pathname, allItems))

  // Route changes come from tapping a link in here, so the sheet must stand down.
  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    // The page behind must not scroll while the sheet is over it.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.querySelector<HTMLElement>('a')?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="-ml-1 flex h-9 w-9 items-center justify-center rounded-md text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary lg:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden />
        <span className="sr-only">Menu{current ? `, currently on ${current.label}` : ''}</span>
      </button>

      {/* Portalled to the body on purpose. The top bar sets `backdrop-blur`,
          and an element with a backdrop-filter becomes the containing block for
          its fixed-position descendants — rendering the sheet in place pinned
          it to the 60px header instead of the viewport. */}
      {open && mounted && createPortal(
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-navy-900/40 backdrop-blur-[2px]"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col border-r border-line-subtle bg-surface-page shadow-drawer"
          >
            <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-line-subtle pl-5 pr-3">
              <Link href="/" className="flex items-center gap-2" aria-label="Bluecroft Stock — dashboard">
                <span className="h-2.5 w-2.5 rounded-pill bg-teal-500" aria-hidden />
                <span className="text-body-lg font-extrabold text-content-primary">bluecroft</span>
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-2 text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <nav aria-label="Main" className="flex-1 overflow-y-auto px-2.5 py-4">
              {groups.map((group, index) => (
                <div key={group.heading ?? `group-${index}`} className={index > 0 ? 'mt-6' : undefined}>
                  {group.heading && (
                    <p className="mb-1.5 px-2.5 text-micro font-semibold uppercase tracking-wide text-content-secondary">
                      {group.heading}
                    </p>
                  )}
                  <ul className="flex flex-col gap-0.5">
                    {group.items.map((item) => {
                      const active = isActive(item, pathname, allItems)
                      const Icon = item.icon
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                              // 44px minimum height: this is a thumb target, not a pointer target.
                              'flex min-h-[44px] items-center gap-3 rounded-md px-2.5 py-2 text-body transition-colors',
                              active
                                ? 'bg-navy-700/10 font-bold text-content-primary'
                                : 'font-medium text-content-secondary hover:bg-surface-subtle hover:text-content-primary',
                            )}
                          >
                            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.count !== undefined && item.count > 0 && (
                              <span
                                className={cn(
                                  'shrink-0 rounded-pill px-1.5 py-0.5 text-micro font-bold tabular-nums',
                                  item.attention ? 'bg-state-gold/20 text-state-gold' : 'text-content-secondary',
                                )}
                              >
                                {item.count}
                              </span>
                            )}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
