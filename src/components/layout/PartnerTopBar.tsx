import Link from 'next/link'
import { UserMenu } from './UserMenu'
import { CurrencySwitcher } from './CurrencySwitcher'
import { ThemeToggle } from '@/components/ui'
import type { SessionUser } from '@/server/auth/session'

/**
 * The whole navigation for somebody outside the business.
 *
 * One bar, because there is one page. A trade partner had the staff shell —
 * a sidebar rail holding a single item, a bottom bar on mobile holding the
 * same one, and a command palette offering to book in a purchase, open the
 * deal pipeline and search the customer book. None of it worked for them, and
 * the palette was worse than useless: it read out the shape of our operation
 * to a dealer, in a list, before they had typed anything.
 *
 * So the shell is built for the audience rather than filtered down from
 * somebody else's. Nothing here is hidden by a capability check, because
 * nothing they may not have is rendered in the first place.
 */
export function PartnerTopBar({ user, links }: {
  user: SessionUser
  links: Array<{ href: string; label: string }>
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line-subtle bg-surface-page/95 backdrop-blur">
      <div className="mx-auto flex h-[64px] w-full max-w-[1800px] items-center gap-6 px-5 lg:px-8">
        <Link href="/catalogue" className="flex shrink-0 items-center gap-2" aria-label="Bluecroft Stock">
          <span className="h-2 w-2 rounded-pill bg-teal-500" aria-hidden />
          <span className="text-body-lg font-extrabold text-content-primary">bluecroft</span>
        </Link>

        {links.length > 1 && (
          <nav aria-label="Main">
            <ul className="flex items-center gap-1">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="rounded-md px-3 py-2 text-body font-semibold text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2">
          <CurrencySwitcher />
          <ThemeToggle />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  )
}
