'use client'
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { useUnread } from './LiveNotifications'

/** The trade partner's one badge, and the only one that is about them. */
export function EnquiriesLink({ initial }: { initial: number }) {
  const waiting = useUnread(initial)
  return (
    // Icon-only on a phone, with the count sitting on the icon rather than
    // beside it; and icon-only again on the partner bar's single row until it
    // is wide enough to spare the word — there the width belongs to search.
    <Link
      href="/enquiries"
      aria-label={waiting > 0 ? `Enquiries, ${waiting} with replies` : 'Enquiries'}
      className="relative inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-sm px-2 text-caption font-semibold uppercase tracking-[0.1em] text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary sm:px-2.5"
    >
      <MessageSquare className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline xl:hidden min-[1400px]:inline">Enquiries</span>
      {waiting > 0 && (
        <span className="absolute right-0 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-500 px-1 text-[10px] tabular-nums text-white sm:static sm:h-auto sm:px-1.5 sm:py-0.5">
          {waiting}
        </span>
      )}
    </Link>
  )
}
