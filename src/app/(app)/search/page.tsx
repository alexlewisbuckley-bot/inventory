import type { Metadata } from 'next'
import { requireUser } from '@/server/auth/session'
import { PageHeader } from '@/components/layout/PageHeader'
import { SearchScreen } from '@/components/search/SearchScreen'

export const metadata: Metadata = { title: 'Search' }
export const dynamic = 'force-dynamic'

/**
 * Search as a place, for devices where ⌘K does not exist.
 *
 * On a desktop the palette is an overlay because a keyboard summons and
 * dismisses it in a keystroke. A phone has no keystroke, so search is a
 * destination on the bottom bar instead — one tap from anywhere, full-screen,
 * input focused on arrival. Same endpoint, same six object types, same
 * ranking; only the container differs.
 */
export default async function SearchPage() {
  await requireUser()
  return (
    <>
      <PageHeader
        title="Search"
        description="Anyone and anything — a name, a stock number, part of a phone number."
      />
      <SearchScreen />
    </>
  )
}
