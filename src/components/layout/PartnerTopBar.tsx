import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
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
export function PartnerTopBar({ user, brands, enquiries = 0 }: {
  user: SessionUser
  brands: string[]
  /** Enquiries of theirs with something they have not read. */
  enquiries?: number
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
          {/* The other half of the catalogue: having asked about something,
              this is where the answer arrives. */}
          <Link
            href="/enquiries"
            className="relative inline-flex h-9 items-center gap-1.5 rounded-sm px-2.5 text-caption font-semibold uppercase tracking-[0.1em] text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary"
          >
            <MessageSquare className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Enquiries</span>
            {enquiries > 0 && (
              <span className="rounded-full bg-teal-500 px-1.5 py-0.5 text-[10px] tabular-nums text-white">
                {enquiries}
              </span>
            )}
          </Link>
          <CurrencySwitcher />
          <ThemeToggle compact />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  )
}
