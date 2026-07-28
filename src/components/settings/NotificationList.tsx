'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowRightLeft, Bell, CheckCheck, PackagePlus, Receipt } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, useToast } from '@/components/ui'
import { markAllNotificationsReadAction, markNotificationReadAction } from '@/app/actions/admin'
import { relativeTime } from '@/lib/dates'
import type { NotificationType } from '@/lib/enums'

export interface NotificationView {
  id: string
  type: NotificationType
  title: string
  body: string | null
  entityType: string | null
  entityId: string | null
  readAt: string | null
  createdAt: string
}

const ICONS: Record<NotificationType, typeof Bell> = {
  STOCK_ADDED: PackagePlus,
  SALE_RECORDED: Receipt,
  WATCH_MOVED: ArrowRightLeft,
  PRICE_MISSING: AlertTriangle,
  AGEING_STOCK: AlertTriangle,
  SYSTEM: Bell,
}

/** Notification feed with per-item and bulk read handling. */
export function NotificationList({ items }: { items: NotificationView[] }) {
  const router = useRouter()
  // Optimistic: mark read in the UI immediately, reconcile on refresh.
  const [readLocally, setReadLocally] = useState<Set<string>>(new Set())

  const open = async (item: NotificationView) => {
    if (!item.readAt && !readLocally.has(item.id)) {
      setReadLocally((current) => new Set(current).add(item.id))
      await markNotificationReadAction(item.id)
      router.refresh()
    }
  }

  return (
    <ul className="divide-y divide-line-subtle">
        {items.map((item) => {
          const Icon = ICONS[item.type]
          const unread = !item.readAt && !readLocally.has(item.id)
          const href = item.entityType === 'Watch' && item.entityId ? `/inventory/${item.entityId}` : null
          const body = (
            <div className={cn('flex gap-4 px-6 py-4', unread && 'bg-teal-100/40')}>
              <span
                className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                  unread ? 'bg-teal-500/20 text-content-accent' : 'bg-surface-subtle text-content-secondary',
                )}
                aria-hidden
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('flex items-center gap-2 text-body text-content-primary', unread && 'font-bold')}>
                  {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-pill bg-teal-500" aria-hidden />}
                  {item.title}
                  {unread && <span className="sr-only"> (unread)</span>}
                </p>
                {item.body && <p className="mt-0.5 text-small text-content-secondary">{item.body}</p>}
                <p className="mt-1 text-caption text-content-secondary">{relativeTime(item.createdAt)}</p>
              </div>

            </div>
          )

          return (
            <li key={item.id}>
              {href ? (
                <Link href={href} onClick={() => void open(item)} className="block hover:bg-surface-subtle">
                  {body}
                </Link>
              ) : (
                <button type="button" onClick={() => void open(item)} className="block w-full text-left hover:bg-surface-subtle">
                  {body}
                </button>
              )}
            </li>
          )
      })}
    </ul>
  )
}

/** The bulk action, rendered into the page header. */
export function MarkAllReadButton() {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const markAll = async () => {
    setBusy(true)
    const result = await markAllNotificationsReadAction()
    setBusy(false)
    toast.success('Marked as read', result.message)
    router.refresh()
  }

  return (
    <Button variant="secondary" onClick={markAll} loading={busy} icon={<CheckCheck className="h-4 w-4" />}>
      Mark all as read
    </Button>
  )
}
