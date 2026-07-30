import { redirect } from 'next/navigation'
import { and, count, eq, inArray, isNull, lte, not, or } from 'drizzle-orm'
import { getSessionUser } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { liveSale } from '@/server/db/predicates'
import { deals, notifications, tasks, watchRequests } from '@/server/db/schema'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { TopBar } from '@/components/layout/TopBar'
import { BottomBar } from '@/components/layout/BottomBar'
import { KeyboardShortcuts } from '@/components/layout/KeyboardShortcuts'
import { countUnpriced, findAgeingStock, summariseInventory } from '@/server/repositories/watch-repository'
import { watchQuerySchema } from '@/lib/validation'
import { sales } from '@/server/db/schema'
import { CurrencyProvider } from '@/components/ui/CurrencyProvider'
import { getRateTable } from '@/server/services/fx-service'
import { getPreferencesFor } from '@/server/services/settings-service'
import { isCurrency } from '@/lib/currency'
import { BASE_CURRENCY, type Role } from '@/lib/enums'
import { can } from '@/lib/permissions'

/**
 * Authenticated shell. Every route in this group is guaranteed a session —
 * middleware redirects anonymous traffic, and this layout re-checks server-side
 * because middleware only inspects cookie presence.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const activeQuery = watchQuerySchema.parse({ status: ['IN_STOCK', 'RESERVED', 'SALE_AGREED'] })

  // The badges are the reason the sidebar is worth looking at, so they are
  // counted here rather than on each page: a number that only appears once you
  // are already on the screen it describes is not a prompt.
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  const [
    unread, rates, preferences, stock, unpriced, ageing, saleCount,
    openDeals, tasksDue, openRequests,
  ] = await Promise.all([
    db.select({ value: count() }).from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
    getRateTable(),
    getPreferencesFor(user.id),
    summariseInventory(activeQuery),
    countUnpriced(),
    findAgeingStock(90, 500),
    db.select({ value: count() }).from(sales).where(liveSale()),
    db.select({ value: count() }).from(deals)
      .where(and(isNull(deals.deletedAt), not(inArray(deals.stage, ['WON', 'LOST'])))),
    db.select({ value: count() }).from(tasks)
      .where(and(
        isNull(tasks.deletedAt), eq(tasks.status, 'OPEN'),
        eq(tasks.assigneeId, user.id), lte(tasks.dueAt, endOfToday),
      )),
    db.select({ value: count() }).from(watchRequests)
      .where(and(isNull(watchRequests.deletedAt), inArray(watchRequests.status, ['OPEN', 'SOURCING', 'MATCHED']))),
  ])

  const displayCurrency = isCurrency(preferences?.displayCurrency)
    ? preferences.displayCurrency
    : BASE_CURRENCY

  const counts = {
    inStock: stock.inStockCount,
    unpriced,
    ageing: ageing.length,
    sales: Number(saleCount[0]?.value ?? 0),
    openDeals: Number(openDeals[0]?.value ?? 0),
    tasksDue: Number(tasksDue[0]?.value ?? 0),
    openRequests: Number(openRequests[0]?.value ?? 0),
  }

  return (
    <CurrencyProvider initial={displayCurrency} rates={rates}>
      <div className="flex min-h-screen bg-surface-subtle">
        <AppSidebar role={user.role as Role} counts={counts} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar user={user} unreadCount={Number(unread[0]?.value ?? 0)} counts={counts} />
          <main
            id="main"
            // Focusable only as a skip-link target, never in the tab order.
            tabIndex={-1}
            // Bottom padding below lg clears the bottom bar, so the last row
            // of any list is never hidden under the navigation.
            className="mx-auto w-full max-w-[1500px] flex-1 px-5 py-7 pb-24 outline-none lg:px-8 lg:pb-7"
          >
            {children}
          </main>
        </div>
      </div>
      <BottomBar />
      <KeyboardShortcuts canCreate={can(user.role, 'watch:create')} />
    </CurrencyProvider>
  )
}
