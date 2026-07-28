import type { Metadata } from 'next'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { requireUser } from '@/server/auth/session'
import { listNotifications, unreadCount } from '@/server/services/notification-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, EmptyState } from '@/components/ui'
import { NotificationList, MarkAllReadButton } from '@/components/settings/NotificationList'

export const metadata: Metadata = { title: 'Notifications' }
export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  const user = await requireUser()
  const [items, unread] = await Promise.all([listNotifications(user.id, 100), unreadCount(user.id)])

  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread > 0
          ? `${unread} unread of ${items.length}`
          : 'Everything your colleagues change that affects your stock.'}
        actions={unread > 0 ? <MarkAllReadButton /> : undefined}
      />

      <Card className="max-w-4xl overflow-hidden">
        {items.length === 0 ? (
          <EmptyState
            icon={<Bell className="h-6 w-6" />}
            title="Nothing yet"
            description="You will be told when stock is added, moved or sold by someone else, and when watches need a price."
            action={<Link href="/inventory" className="text-body font-bold text-content-accent hover:underline">Go to inventory</Link>}
          />
        ) : (
          <NotificationList
            items={items.map((item) => ({
              id: item.id,
              type: item.type,
              title: item.title,
              body: item.body,
              entityType: item.entityType,
              entityId: item.entityId,
              readAt: item.readAt?.toISOString() ?? null,
              createdAt: item.createdAt.toISOString(),
            }))}
          />
        )}
      </Card>
    </>
  )
}
