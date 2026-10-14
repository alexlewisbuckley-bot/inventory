import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { can } from '@/lib/permissions'
import { db } from '@/server/db/client'
import { users } from '@/server/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { listSalesPeopleAdmin } from '@/server/services/reference-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { SalesPeopleManager, type SalesPersonRow } from '@/components/reference/SalesPeopleManager'

export const metadata: Metadata = { title: 'Sales people' }
export const dynamic = 'force-dynamic'

/**
 * Who sells, and which account is which person.
 *
 * Two jobs in one short list. It decides whose name can go on a sale, so a
 * seventh person is a row here rather than a deploy; and it ties a name to a
 * login, which is the only thing that makes "my sales" answerable — without
 * the link there is no way to tell which salesperson a signed-in reader is.
 */
export default async function SalesPeoplePage() {
  const user = await requireCapability('user:read')

  const [people, accounts] = await Promise.all([
    listSalesPeopleAdmin(),
    db.select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(asc(users.name)),
  ])

  const rows: SalesPersonRow[] = people.map((person) => ({
    id: person.id,
    name: person.name,
    isActive: person.isActive,
    retainer: person.retainer,
    commissionBps: person.commissionBps,
    userId: person.userId,
    userName: person.userName,
    userEmail: person.userEmail,
    soldCount: Number(person.soldCount),
  }))

  return (
    <>
      <PageHeader
        title="Sales people"
        description="Whose name can go on a sale, and which account belongs to which of them."
      />

      <SalesPeopleManager
        people={rows}
        users={accounts}
        canManage={can(user.role, 'user:manage')}
      />

      <p className="mt-4 text-caption text-content-secondary">
        Somebody who has been named on a sale is never deleted, only deactivated — removing
        them would take the attribution off every sale they closed, and a quarter that
        quietly loses its figures because a leaver was tidied up is worse than a name in a
        list nobody uses.
      </p>
    </>
  )
}
