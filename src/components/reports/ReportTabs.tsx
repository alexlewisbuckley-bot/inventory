'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'

export interface ReportTab {
  href: string
  label: string
}

/**
 * The reports section, as one thing rather than three pages.
 *
 * Ageing stock and sales by person were reachable only from a link buried in
 * a card on the overview, which meant that unless you already knew they
 * existed you did not know they existed. A tab row is the cheapest honest
 * statement of what the section contains.
 *
 * Which tabs appear is decided on the server from the reader's capabilities
 * and passed in, not worked out here — a tab is a door, and a door drawn for
 * somebody who cannot open it is a worse answer than no door.
 */
export function ReportTabs({ tabs }: { tabs: ReportTab[] }) {
  const pathname = usePathname()

  // One tab is not a choice, and a tab bar that offers no alternative is
  // chrome that costs a row of vertical space on every page.
  if (tabs.length < 2) return null

  return (
    <nav aria-label="Reports" className="mb-6 border-b border-line-subtle">
      <ul className="-mb-px flex flex-wrap gap-x-5">
        {tabs.map((tab) => {
          // Exact for the index, prefix for the rest, so /reports does not
          // light up while you are on /reports/people.
          const active = tab.href === '/reports'
            ? pathname === '/reports'
            : pathname.startsWith(tab.href)
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-block border-b-2 px-0.5 pb-2.5 text-small font-semibold transition-colors',
                  active
                    ? 'border-content-accent text-content-primary'
                    : 'border-transparent text-content-secondary hover:border-line-strong hover:text-content-primary',
                )}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
