'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, Coins, History, ShieldCheck, SlidersHorizontal, UserCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { can, type Capability } from '@/lib/permissions'
import type { Role } from '@/lib/enums'

const ITEMS: Array<{ href: string; label: string; icon: typeof UserCircle; capability?: Capability }> = [
  { href: '/settings/profile', label: 'Your profile', icon: UserCircle },
  { href: '/settings', label: 'Application', icon: SlidersHorizontal, capability: 'settings:read' },
  { href: '/settings/currencies', label: 'Currencies & FX', icon: Coins, capability: 'settings:read' },
  { href: '/settings/users', label: 'Users & permissions', icon: ShieldCheck, capability: 'user:read' },
  { href: '/settings/audit', label: 'Audit trail', icon: History, capability: 'audit:read' },
]

/** Sub-navigation for the settings area. */
export function SettingsNav({ role }: { role: Role }) {
  const pathname = usePathname()
  const visible = ITEMS.filter((item) => !item.capability || can(role, item.capability))

  return (
    <nav aria-label="Settings" className="mb-8">
      <ul className="flex flex-wrap gap-1 border-b border-line-subtle">
        {visible.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-4 py-3 text-body transition-colors',
                  active
                    ? 'border-teal-500 font-bold text-content-primary'
                    : 'border-transparent font-medium text-content-secondary hover:text-content-primary',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export { Building2 }
