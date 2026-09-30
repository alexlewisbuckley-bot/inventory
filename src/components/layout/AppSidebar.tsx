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
 * One curve and one duration for every part of the rail.
 *
 * Collapsing used to animate the width and nothing else: the labels, the
 * group headings, the dividers and the mark were all conditionally rendered,
 * so they vanished on the first frame while the rail spent the next fifth of
 * a second sliding in behind them. Three separate events read as a jolt, not
 * a movement. Everything that changes now changes on this one curve, so the
 * rail narrows, the words fade and the lockup becomes the monogram as a
 * single gesture.
 *
 * The curve leaves quickly and settles slowly, which is what makes a fast
 * movement feel unhurried; 300ms is long enough to read as deliberate and
 * short enough not to be waited on.
 */
const RAIL_MOTION = 'duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none'

/**
 * Where an icon must sit to be centred in the 68px collapsed rail. Stated
 * rather than centred with `justify-center`, because a change of justification
 * cannot be animated — the icon would jump to the middle while the rail was
 * still moving. As a padding it travels with everything else.
 */
const COLLAPSED_ICON_INSET = 'pl-[26px] pr-0'

/**
 * The lockup and the monogram hand over rather than cross-fade.
 *
 * Fading both at once put the two marks on top of each other for about a
 * fifth of a second — the OS sat under the O and N of ONE like a misprint. So
 * the outgoing one leaves over the first 130ms and the incoming one waits for
 * it before arriving over the remaining 170ms. The pair still finishes exactly
 * with the rail at 300ms, and at no point are both of them legible.
 */
const MARK_FADE = (shown: boolean) => cn(
  'transition-opacity ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
  shown ? 'opacity-100 delay-[130ms] duration-[170ms]' : 'opacity-0 delay-0 duration-[130ms]',
)

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
        // `overflow-hidden` is what lets the labels stay in the tree while the
        // rail closes over them, instead of being unmounted out from under the
        // animation.
        'sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-line-subtle bg-surface-page lg:flex',
        'transition-[width]', RAIL_MOTION,
        collapsed ? 'w-[68px]' : 'w-[232px]',
      )}
      // Avoid a flash of the wrong width before localStorage is read. The
      // transition is suppressed for that first paint too, so restoring a
      // collapsed rail on load is not itself an animation.
      style={{ visibility: mounted ? 'visible' : 'hidden', transitionDuration: mounted ? undefined : '0ms' }}
    >
      <div
        className={cn(
          'flex h-[60px] shrink-0 items-center border-b border-line-subtle transition-[padding]',
          RAIL_MOTION,
          // 22px puts the 24px monogram in the middle of a 68px rail — within
          // two pixels of where the lockup already starts, so the mark barely
          // moves and the two simply dissolve into one another.
          collapsed ? 'pl-[22px] pr-0' : 'px-5',
        )}
      >
        <Link href="/" className="relative block" aria-label="One Street Watches — dashboard">
          {/* Both marks are in the tree and hand over to one another. Swapping
              one for the other mid-slide was the most visible part of the
              jolt: the rail was still moving when the lockup disappeared. */}
          <span className={cn('block', MARK_FADE(!collapsed))} aria-hidden={collapsed}>
            <Wordmark />
          </span>
          <span
            className={cn('absolute inset-y-0 left-0 flex items-center', MARK_FADE(collapsed))}
            aria-hidden={!collapsed}
          >
            <Wordmark compact />
          </span>
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
      <nav aria-label="Main" className="flex-1 overflow-y-auto overflow-x-hidden py-5">
        {groups.map((group, index) => {
          return (
            <div
              key={group.heading ?? `group-${index}`}
              className={cn(
                index > 0 && 'mt-5 border-t pt-5 transition-colors',
                index > 0 && RAIL_MOTION,
                // A hairline between groups instead of a gap alone: it is the
                // brand's own device, and it holds the sections apart at a
                // glance without spending 24px of rail on every one. It fades
                // rather than being switched off, which is the same rule as
                // everything else here.
                index > 0 && (collapsed ? 'border-transparent' : 'border-line-subtle'),
              )}
            >
              {group.heading && (
                <p
                  className={cn(
                    'overflow-hidden whitespace-nowrap px-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted',
                    'transition-[opacity,max-height,margin-bottom]', RAIL_MOTION,
                    // Height as well as opacity: a heading that only faded
                    // would leave its line of empty rail behind.
                    collapsed ? 'mb-0 max-h-0 opacity-0' : 'mb-3 max-h-5 opacity-100',
                  )}
                  aria-hidden={collapsed}
                >
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
                          'relative flex h-10 items-center gap-3 text-[11.5px] uppercase tracking-[0.11em]',
                          'transition-[padding,color]', RAIL_MOTION,
                          collapsed ? COLLAPSED_ICON_INSET : 'pl-5 pr-4',
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
                        {/* Label and count share one wrapper so there is one
                            flex gap to collapse rather than two, and so they
                            leave together. */}
                        <span
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-3 overflow-hidden whitespace-nowrap',
                            'transition-[opacity,max-width]', RAIL_MOTION,
                            collapsed ? 'max-w-0 opacity-0' : 'max-w-[170px] opacity-100',
                          )}
                          aria-hidden={collapsed}
                        >
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
                        </span>
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
          'flex h-11 shrink-0 items-center gap-2 overflow-hidden border-t border-line-subtle text-caption font-semibold text-content-secondary hover:bg-surface-subtle hover:text-content-primary',
          'transition-[padding,color,background-color]', RAIL_MOTION,
          collapsed ? COLLAPSED_ICON_INSET : 'px-4',
        )}
      >
        <ChevronsLeft
          className={cn('h-4 w-4 shrink-0 transition-transform', RAIL_MOTION, collapsed && 'rotate-180')}
          aria-hidden
        />
        <span
          className={cn(
            'overflow-hidden whitespace-nowrap transition-[opacity,max-width]', RAIL_MOTION,
            collapsed ? 'max-w-0 opacity-0' : 'max-w-[90px] opacity-100',
          )}
          aria-hidden={collapsed}
        >
          Collapse
        </span>
      </button>
    </aside>
  )
}
