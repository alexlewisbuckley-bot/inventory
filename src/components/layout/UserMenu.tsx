'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, LogOut, Settings, Shield, User as UserIcon, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Avatar } from '@/components/ui'
import { logoutAction } from '@/app/actions/auth'
import { can } from '@/lib/permissions'
import { ROLE_LABELS, type Role } from '@/lib/enums'
import type { SessionUser } from '@/server/auth/session'

/** Account dropdown. Closes on outside click, Escape, or route change. */
export function UserMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const links = [
    { href: '/settings/profile', label: 'Your profile', icon: UserIcon, show: true },
    { href: '/settings', label: 'Settings', icon: Settings, show: can(user.role, 'settings:read') },
    { href: '/settings/users', label: 'Users & permissions', icon: Shield, show: can(user.role, 'user:read') },
    { href: '/help', label: 'Help & shortcuts', icon: HelpCircle, show: true },
  ].filter((l) => l.show)

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-md p-1 transition-colors hover:bg-surface-subtle"
      >
        <Avatar initials={user.initials} id={user.id} size="sm" />
        <span className="sr-only">Account menu for {user.name}</span>
        <ChevronDown className={cn('h-4 w-4 text-content-secondary transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-md border border-line-subtle bg-surface-raised shadow-raised animate-slide-up"
        >
          <div className="border-b border-line-subtle px-4 py-3">
            <p className="truncate text-body font-bold text-content-primary">{user.name}</p>
            <p className="truncate text-caption text-content-secondary">{user.email}</p>
            <p className="mt-1 text-micro font-semibold uppercase tracking-wide text-content-accent">
              {ROLE_LABELS[user.role as Role]}
            </p>
          </div>

          <ul className="py-1">
            {links.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-body text-content-primary hover:bg-surface-subtle"
                >
                  <Icon className="h-4 w-4 text-content-secondary" aria-hidden />
                  {label}
                </Link>
              </li>
            ))}
          </ul>

          <form action={logoutAction} className="border-t border-line-subtle">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-3 px-4 py-2.5 text-body text-state-danger hover:bg-state-danger/8"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
