'use client'
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { useUnread } from './LiveNotifications'

/** The trade partner's one badge, and the only one that is about them. */
export function EnquiriesLink({ initial }: { initial: number }) {
  const waiting = useUnread(initial)
  return (
    <Link
      href="/enquiries"
      className="relative inline-flex h-9 items-center gap-1.5 rounded-sm px-2.5 text-caption font-semibold uppercase tracking-[0.1em] text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary"
    >
      <MessageSquare className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">Enquiries</span>
      {waiting > 0 && (
        <span className="rounded-full bg-teal-500 px-1.5 py-0.5 text-[10px] tabular-nums text-white">
          {waiting}
        </span>
      )}
    </Link>
  )
}
