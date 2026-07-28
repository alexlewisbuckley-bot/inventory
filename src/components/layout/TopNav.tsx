'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import { can, type Capability } from '@/lib/permissions'
import type { Role } from '@/lib/enums'

interface NavItem {
  href: string
  label: string
  capability?: Capability
  /** Also highlight for nested routes under this path. */
  match?: string
}

const ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/inventory', label: 'Inventory', capability: 'watch:read', match: '/inventory' },
  { href: '/sales', label: 'Sales', capability: 'sale:read', match: '/sales' },
  { href: '/suppliers', label: 'Suppliers', capability: 'supplier:read', match: '/suppliers' },
  { href: '/locations', label: 'Locations', capability: 'location:read', match: '/locations' },
  { href: '/reports', label: 'Reports', capability: 'report:read', match: '/reports' },
]

export function TopNav({ role }: { role: Role }) {
  const pathname = usePathname()
  const visible = ITEMS.filter((item) => !item.capability || can(role, item.capability))

  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {visible.map((item) => {
          const active = item.match ? pathname.startsWith(item.match) : pathname === item.href
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-2 text-body transition-colors',
                  active
                    ? 'font-bold text-content-primary'
                    : 'font-medium text-content-secondary hover:text-content-primary',
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Collapsed navigation for small screens. */
export function MobileNav({ role }: { role: Role }) {
  const pathname = usePathname()
  const visible = ITEMS.filter((item) => !item.capability || can(role, item.capability))

  return (
    <nav aria-label="Main" className="border-t border-line-subtle bg-surface-page md:hidden">
      <ul className="flex overflow-x-auto px-4">
        {visible.map((item) => {
          const active = item.match ? pathname.startsWith(item.match) : pathname === item.href
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block whitespace-nowrap border-b-2 px-3 py-3 text-small',
                  active
                    ? 'border-teal-500 font-bold text-content-primary'
                    : 'border-transparent font-medium text-content-secondary',
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
