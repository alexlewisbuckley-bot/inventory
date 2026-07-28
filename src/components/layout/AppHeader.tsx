import Link from 'next/link'
import { Bell } from 'lucide-react'
import { TopNav, MobileNav } from './TopNav'
import { UserMenu } from './UserMenu'
import { ThemeToggle } from '@/components/ui'
import { CommandTrigger } from './CommandTrigger'
import type { SessionUser } from '@/server/auth/session'
import type { Role } from '@/lib/enums'

export function AppHeader({ user, unreadCount }: { user: SessionUser; unreadCount: number }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line-subtle bg-surface-page/95 backdrop-blur">
      <div className="flex h-[72px] items-center gap-8 px-6 lg:px-10">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Bluecroft Stock — dashboard">
          <span className="text-h3 font-extrabold text-content-primary">bluecroft</span>
          <span className="h-2 w-2 rounded-full bg-teal-500" aria-hidden />
        </Link>

        <TopNav role={user.role as Role} />

        <div className="ml-auto flex items-center gap-2">
          <CommandTrigger />
          <Link
            href="/notifications"
            className="relative rounded-md p-2 text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          >
            <Bell className="h-5 w-5" aria-hidden />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-state-danger px-1 text-[10px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>
          <div className="hidden lg:block"><ThemeToggle compact /></div>
          <UserMenu user={user} />
        </div>
      </div>
      <MobileNav role={user.role as Role} />
    </header>
  )
}
