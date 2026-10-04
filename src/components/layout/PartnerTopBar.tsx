import Link from 'next/link'
import { Wordmark } from './Wordmark'
import { EnquiriesLink } from './EnquiriesLink'
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
 * What is left is one bar. The filters live in it rather than in a card below
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
    <>
      {/*
        Only the slim row stays pinned. On a phone the filters used to ride
        along inside the sticky bar, and a bar holding a search box, two
        selects and a view switch covered a third of the screen for the whole
        scroll. Now the filters sit in their own band under the bar and
        scroll away with the page; at xl, where they fit beside the mark,
        they move up into the bar and the band is not rendered.

        The side padding matches <main> in the partner shell exactly, so the
        bar, the filters and the first tile all start on the same line.
      */}
      <header className="sticky top-0 z-30 border-b border-line-subtle bg-surface-page/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1800px] items-center gap-3 px-4 sm:gap-4 sm:px-5 lg:px-8 xl:h-auto xl:gap-5 xl:py-2.5">
          <Link href="/catalogue" className="flex shrink-0 items-center" aria-label="One Street Watches — inventory">
            <Wordmark />
          </Link>

          <CatalogueControls brands={brands} className="hidden xl:flex" />

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
            {/* The other half of the catalogue: having asked about something,
                this is where the answer arrives. */}
            <EnquiriesLink initial={enquiries} />
            <CurrencySwitcher />
            {/* Not on a phone: the row there is the mark and three controls,
                and the theme is also under Your profile. */}
            <div className="hidden sm:block"><ThemeToggle compact /></div>
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      <CatalogueControls
        brands={brands}
        className="border-b border-line-subtle bg-surface-page px-4 py-3 sm:px-5 lg:px-8 xl:hidden"
      />
    </>
  )
}
