import Link from 'next/link'
import { Wordmark } from './Wordmark'
import { NotificationBell } from './NotificationBell'
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
        <Link href="/" className="hidden items-center sm:flex lg:hidden" aria-label="One Street Watches — dashboard">
          <Wordmark />
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <CommandTrigger />
          <CurrencySwitcher />
          <NotificationBell initial={unreadCount} />
          <div className="hidden xl:block"><ThemeToggle compact /></div>
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  )
}
