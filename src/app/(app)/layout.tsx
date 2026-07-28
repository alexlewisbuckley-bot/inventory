import { redirect } from 'next/navigation'
import { and, count, eq, isNull } from 'drizzle-orm'
import { getSessionUser } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { notifications } from '@/server/db/schema'
import { AppHeader } from '@/components/layout/AppHeader'
import { CurrencyProvider } from '@/components/ui/CurrencyProvider'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { isCurrency } from '@/lib/currency'
import { BASE_CURRENCY } from '@/lib/enums'

/**
 * Authenticated shell. Every route in this group is guaranteed a session —
 * middleware redirects anonymous traffic, and this layout re-checks server-side
 * because middleware only inspects cookie presence.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const [unread, rates, preferences] = await Promise.all([
    db.select({ value: count() }).from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
    getRateTable(),
    getPreferencesFor(user.id),
  ])

  const displayCurrency = isCurrency(preferences?.displayCurrency)
    ? preferences.displayCurrency
    : BASE_CURRENCY

  return (
    <CurrencyProvider initial={displayCurrency} rates={rates}>
      <div className="min-h-screen bg-surface-subtle">
        <AppHeader user={user} unreadCount={Number(unread[0]?.value ?? 0)} />
        <main id="main" className="mx-auto w-full max-w-[1600px] px-6 py-8 lg:px-10">
          {children}
        </main>
      </div>
    </CurrencyProvider>
  )
}
