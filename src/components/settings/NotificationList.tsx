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
export function NotificationList({ items, hasUnread }: { items: NotificationView[]; hasUnread: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  // Optimistic: mark read in the UI immediately, reconcile on refresh.
  const [readLocally, setReadLocally] = useState<Set<string>>(new Set())

  const markAll = async () => {
    setBusy(true)
    const result = await markAllNotificationsReadAction()
    setBusy(false)
    setReadLocally(new Set(items.map((i) => i.id)))
    toast.success('Marked as read', result.message)
    router.refresh()
  }

  const open = async (item: NotificationView) => {
    if (!item.readAt && !readLocally.has(item.id)) {
      setReadLocally((current) => new Set(current).add(item.id))
      await markNotificationReadAction(item.id)
      router.refresh()
    }
  }

  return (
    <>
      {hasUnread && (
        <div className="flex justify-end border-b border-line-subtle px-6 py-3">
          <Button variant="ghost" size="sm" onClick={markAll} loading={busy} icon={<CheckCheck className="h-4 w-4" />}>
            Mark all as read
          </Button>
        </div>
      )}

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
                <p className={cn('text-body text-content-primary', unread && 'font-bold')}>
                  {item.title}
                  {unread && <span className="sr-only"> (unread)</span>}
                </p>
                {item.body && <p className="mt-0.5 text-small text-content-secondary">{item.body}</p>}
                <p className="mt-1 text-caption text-content-secondary">{relativeTime(item.createdAt)}</p>
              </div>
              {unread && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-teal-500" aria-hidden />}
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
    </>
  )
}
