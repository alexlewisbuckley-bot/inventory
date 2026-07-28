'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronsLeft } from 'lucide-react'
import { cn } from '@/lib/cn'
import { isActive, navGroups, type SidebarCounts } from './nav-model'
import type { Role } from '@/lib/enums'

export type { SidebarCounts }

/**
 * Primary navigation.
 *
 * A persistent sidebar rather than a top bar: with eight destinations the
 * app's shape should be visible at all times, counts belong next to the thing
 * they describe, and horizontal space is the scarce resource on a data-dense
 * table — vertical space is not.
 *
 * Collapsing to icons is remembered per device, because someone working in the
 * inventory table all day wants the width back, while someone moving between
 * sections wants the labels.
 */
export function AppSidebar({ role, counts }: { role: Role; counts: SidebarCounts }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setCollapsed(window.localStorage.getItem('bluecroft.sidebar') === 'collapsed')
  }, [])

  // `[` toggles the sidebar, matching the convention in editors and Linear.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.key === '[' && !event.metaKey && !event.ctrlKey) {
        setCollapsed((current) => {
          const next = !current
          window.localStorage.setItem('bluecroft.sidebar', next ? 'collapsed' : 'expanded')
          return next
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current
      window.localStorage.setItem('bluecroft.sidebar', next ? 'collapsed' : 'expanded')
      return next
    })
  }

  const groups = navGroups(role, counts)

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line-subtle bg-surface-page transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[68px]' : 'w-[232px]',
      )}
      // Avoid a flash of the wrong width before localStorage is read.
      style={{ visibility: mounted ? 'visible' : 'hidden' }}
    >
      <div className={cn('flex h-[60px] items-center border-b border-line-subtle', collapsed ? 'justify-center px-2' : 'px-5')}>
        <Link href="/" className="flex items-center gap-2 overflow-hidden" aria-label="Bluecroft Stock — dashboard">
          <span className="h-2.5 w-2.5 shrink-0 rounded-pill bg-teal-500" aria-hidden />
          {!collapsed && <span className="truncate text-body-lg font-extrabold text-content-primary">bluecroft</span>}
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2.5 py-4">
        {groups.map((group, index) => {
          return (
            <div key={group.heading ?? `group-${index}`} className={index > 0 ? 'mt-6' : undefined}>
              {group.heading && !collapsed && (
                <p className="mb-1.5 px-2.5 text-micro font-semibold uppercase tracking-wide text-content-secondary">
                  {group.heading}
                </p>
              )}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = isActive(item, pathname)
                  const Icon = item.icon
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          'flex h-9 items-center gap-3 rounded-md px-2.5 text-body transition-colors',
                          collapsed && 'justify-center px-0',
                          active
                            ? 'bg-navy-700/10 font-bold text-content-primary'
                            : 'font-medium text-content-secondary hover:bg-surface-subtle hover:text-content-primary',
                        )}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                        {!collapsed && (
                          <>
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.count !== undefined && item.count > 0 && (
                              <span
                                className={cn(
                                  'shrink-0 rounded-pill px-1.5 py-0.5 text-micro font-bold tabular-nums',
                                  item.attention
                                    ? 'bg-state-gold/20 text-state-gold'
                                    : 'text-content-secondary',
                                )}
                              >
                                {item.count}
                              </span>
                            )}
                          </>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={`${collapsed ? 'Expand' : 'Collapse'} sidebar  [`}
        className={cn(
          'flex h-11 items-center gap-2 border-t border-line-subtle px-4 text-caption font-semibold text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary',
          collapsed && 'justify-center px-0',
        )}
      >
        <ChevronsLeft className={cn('h-4 w-4 shrink-0 transition-transform', collapsed && 'rotate-180')} aria-hidden />
        {!collapsed && 'Collapse'}
      </button>
    </aside>
  )
}
