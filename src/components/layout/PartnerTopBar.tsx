import Link from 'next/link'
import { Wordmark } from './Wordmark'
import { UserMenu } from './UserMenu'
import { CurrencySwitcher } from './CurrencySwitcher'
import { CatalogueControls } from '@/components/catalogue/CatalogueControls'
import { ThemeToggle } from '@/components/ui'
import type { SessionUser } from '@/server/auth/session'

/**
 * The whole navigation for somebody outside the business, in one bar.
 *
 * A trade partner had the staff shell — a sidebar rail holding a single item,
 * a bottom bar on mobile holding the same one, and a command palette offering
 * to book in a purchase, open the deal pipeline and search the customer book.
 * The palette was the bad one: it read out the shape of our operation to a
 * dealer, in a list, before they had typed anything.
 *
 * What is left is one row. The filters live in it rather than in a card below
 * a page title, because a title repeating the only nav item, above a card of
 * controls, was two bands of furniture before a single watch appeared.
 *
 * Nothing here is hidden by a capability check, because nothing they may not
 * have is rendered in the first place.
 */
export function PartnerTopBar({ user, brands }: {
  user: SessionUser
  brands: string[]
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line-subtle bg-surface-page/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1800px] flex-wrap items-center gap-x-5 gap-y-2.5 px-5 py-2.5 lg:flex-nowrap lg:px-8">
        <Link href="/catalogue" className="flex shrink-0 items-center" aria-label="One Street Watches — inventory">
          <Wordmark />
        </Link>

        <CatalogueControls brands={brands} />

        {/* Compact: the labelled three-way theme control was as wide as the
            search box, on a bar where the width belongs to the filters. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <CurrencySwitcher />
          <ThemeToggle compact />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  )
}
