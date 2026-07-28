import Link from 'next/link'
import { Bell } from 'lucide-react'
import { UserMenu } from './UserMenu'
import { CommandTrigger } from './CommandTrigger'
import { CurrencySwitcher } from './CurrencySwitcher'
import { MobileNav } from './MobileNav'
import type { SidebarCounts } from './nav-model'
import { ThemeToggle } from '@/components/ui'
import type { SessionUser } from '@/server/auth/session'
import type { Role } from '@/lib/enums'

/**
 * Slim top bar.
 *
 * Navigation lives in the sidebar, so this strip carries only the controls
 * that apply everywhere: search, display currency, notifications and account.
 * Kept to 60px so vertical space goes to the data.
 */
export function TopBar({ user, unreadCount, counts }: {
  user: SessionUser
  unreadCount: number
  counts: SidebarCounts
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line-subtle bg-surface-page/95 backdrop-blur">
      <div className="flex h-[60px] items-center gap-2 px-4 sm:gap-3 sm:px-5 lg:px-7">
        <MobileNav role={user.role as Role} counts={counts} />
        {/* The wordmark appears only where the sidebar is hidden and there is
            room for it: on the narrowest screens the controls win. */}
        <Link href="/" className="hidden items-center gap-2 sm:flex lg:hidden" aria-label="Bluecroft Stock — dashboard">
          <span className="h-2 w-2 rounded-full bg-teal-500" aria-hidden />
          <span className="text-body-lg font-extrabold text-content-primary">bluecroft</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <CommandTrigger />
          <CurrencySwitcher />
          <Link
            href="/notifications"
            className="relative rounded-md p-2 text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          >
            <Bell className="h-[18px] w-[18px]" aria-hidden />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-state-danger px-1 text-[10px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>
          <div className="hidden xl:block"><ThemeToggle compact /></div>
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  )
}
