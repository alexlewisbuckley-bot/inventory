import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { listUsers } from '@/server/services/user-service'
import { UserManager } from '@/components/settings/UserManager'
import { assignableRoles } from '@/lib/permissions'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Users & permissions' }
export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const actor = await requireCapability('user:read')
  const users = await listUsers()

  return (
    <UserManager
      users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null }))}
      currentUserId={actor.id}
      canManage={can(actor.role, 'user:manage')}
      assignable={assignableRoles(actor.role)}
    />
  )
}
