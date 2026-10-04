'use client'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { useUnread } from './LiveNotifications'

/**
 * The bell, with a number that moves on its own.
 *
 * Its own component so the bar around it stays a server component: the only
 * thing on that bar needing to re-render between navigations is this count.
 * The server's figure is the seed, so the badge is right on first paint.
 */
export function NotificationBell({ initial }: { initial: number }) {
  const unread = useUnread(initial)
  return (
    <Link
      href="/notifications"
      className="relative flex h-9 w-9 items-center justify-center rounded-md text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <Bell className="h-[18px] w-[18px]" aria-hidden />
      {unread > 0 && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-state-danger px-1 text-micro font-bold text-content-on-status">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}
