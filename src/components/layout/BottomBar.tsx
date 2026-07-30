'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { KanbanSquare, LayoutDashboard, Search, Users2 } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * The phone's navigation: four destinations, thumb-reachable.
 *
 * A phone is the consultation environment — look somebody up, read what was
 * last said, tick a task, check whether we still have the watch. The four
 * things that serve that live in a bar at the bottom where a thumb actually
 * is; everything else stays in the sheet behind the menu button, which is the
 * honest place for destinations a phone is not the right tool for.
 *
 * Search is a destination here, not an overlay trigger: on a phone the
 * palette's keyboard shortcut does not exist, so reaching search has to cost
 * one tap from anywhere.
 *
 * Targets are 44px minimum less because the guideline says so than because a
 * bar at the very bottom of a phone is hit with the least precise part of the
 * thumb, and a missed tap here navigates somewhere wrong rather than doing
 * nothing.
 */
const ITEMS = [
  { href: '/today', label: 'Today', icon: LayoutDashboard, match: '/today' },
  { href: '/search', label: 'Search', icon: Search, match: '/search' },
  { href: '/pipeline', label: 'Deals', icon: KanbanSquare, match: '/pipeline' },
  { href: '/customers', label: 'Contacts', icon: Users2, match: '/customers' },
] as const

export function BottomBar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line-subtle bg-surface-raised pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.match}/`)
          const Icon = item.icon
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-1.5',
                  active ? 'text-content-accent' : 'text-content-secondary',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span className="text-micro font-semibold">{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
