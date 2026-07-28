import { redirect } from 'next/navigation'
import { and, count, eq, isNull } from 'drizzle-orm'
import { getSessionUser } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { notifications } from '@/server/db/schema'
import { AppHeader } from '@/components/layout/AppHeader'

/**
 * Authenticated shell. Every route in this group is guaranteed a session —
 * middleware redirects anonymous traffic, and this layout re-checks server-side
 * because middleware only inspects cookie presence.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const unread = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)))

  return (
    <div className="min-h-screen bg-surface-subtle">
      <AppHeader user={user} unreadCount={Number(unread[0]?.value ?? 0)} />
      <main id="main" className="mx-auto w-full max-w-[1600px] px-6 py-8 lg:px-10">
        {children}
      </main>
    </div>
  )
}
