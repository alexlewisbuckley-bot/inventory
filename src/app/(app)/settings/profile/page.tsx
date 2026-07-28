import type { Metadata } from 'next'
import { asc, isNull } from 'drizzle-orm'
import { requireUser } from '@/server/auth/session'
import { db } from '@/server/db/client'
import { locations } from '@/server/db/schema'
import { getPreferencesFor } from '@/server/services/settings-service'
import { listSessions } from '@/server/services/user-service'
import { ProfilePanel } from '@/components/settings/ProfilePanel'

export const metadata: Metadata = { title: 'Your profile' }
export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const user = await requireUser()
  const [preferences, sessions, locationRows] = await Promise.all([
    getPreferencesFor(user.id),
    listSessions(user.id),
    db.select({ id: locations.id, name: locations.name }).from(locations)
      .where(isNull(locations.deletedAt)).orderBy(asc(locations.sortOrder)),
  ])

  return (
    <ProfilePanel
      user={user}
      preferences={{
        theme: preferences?.theme ?? 'SYSTEM',
        density: preferences?.density ?? 'COMFORTABLE',
        displayCurrency: preferences?.displayCurrency ?? 'GBP',
        defaultLocationId: preferences?.defaultLocationId ?? '',
        emailNotifications: preferences?.emailNotifications ?? true,
        inAppNotifications: preferences?.inAppNotifications ?? true,
      }}
      locations={locationRows}
      sessions={sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        lastSeenAt: s.lastSeenAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      }))}
    />
  )
}
