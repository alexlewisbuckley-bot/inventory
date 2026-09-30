'use client'
import { useEffect, useState } from 'react'
import { Wordmark } from './Wordmark'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronsLeft } from 'lucide-react'
import { cn } from '@/lib/cn'
import { flattenNav, isActive, navGroups, type SidebarCounts } from './nav-model'
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
  const allItems = flattenNav(groups)

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
        <Link href="/" className="flex items-center overflow-hidden" aria-label="One Street Watches — dashboard">
          <Wordmark compact={collapsed} />
        </Link>
      </div>

      {/*
        The rail, set the way the brand sets navigation.
        
        It was a stack of sentence-case links with a grey rounded slab under
        the current one and round badges on the counts — the standard shape of
        an admin sidebar, and the last place in the application still wearing
        it. The site's own navigation is tracked capitals with nothing behind
        them, so the current page is marked the way a boutique marks one: a
        single sage rule at the edge, and the ink going black. No fill.
      */}
      <nav aria-label="Main" className="flex-1 overflow-y-auto py-5">
        {groups.map((group, index) => {
          return (
            <div
              key={group.heading ?? `group-${index}`}
              className={cn(
                index > 0 && 'mt-5 pt-5',
                // A hairline between groups instead of a gap alone: it is the
                // brand's own device, and it holds the sections apart at a
                // glance without spending 24px of rail on every one.
                index > 0 && !collapsed && 'border-t border-line-subtle',
              )}
            >
              {group.heading && !collapsed && (
                <p className="mb-3 px-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                  {group.heading}
                </p>
              )}
              <ul className="flex flex-col">
                {group.items.map((item) => {
                  const active = isActive(item, pathname, allItems)
                  const Icon = item.icon
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          'relative flex h-10 items-center gap-3 pl-5 pr-4 text-[11.5px] uppercase tracking-[0.11em] transition-colors',
                          collapsed && 'justify-center px-0',
                          active
                            ? 'font-semibold text-content-primary'
                            : 'font-medium text-content-secondary hover:text-content-primary',
                        )}
                      >
                        {/* The marker. Two pixels of sage at the edge, which is
                            all the site uses to say "you are here". */}
                        {active && (
                          <span
                            className="absolute inset-y-0 left-0 w-[2px] bg-teal-500"
                            aria-hidden
                          />
                        )}
                        <Icon className={cn('h-[17px] w-[17px] shrink-0', active && 'text-content-accent')} aria-hidden />
                        {!collapsed && (
                          <>
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.count !== undefined && item.count > 0 && (
                              <span
                                className={cn(
                                  'shrink-0 text-[11px] tabular-nums',
                                  item.attention
                                    ? 'font-semibold text-state-warning'
                                    : 'font-normal text-content-muted',
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
