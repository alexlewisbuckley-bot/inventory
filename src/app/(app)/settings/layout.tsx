import { requireUser } from '@/server/auth/session'
import { PageHeader } from '@/components/layout/PageHeader'
import { SettingsNav } from '@/components/settings/SettingsNav'
import type { Role } from '@/lib/enums'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  return (
    <>
      <PageHeader title="Settings" description="Your account, and how the system behaves for everyone." />
      <SettingsNav role={user.role as Role} />
      {children}
    </>
  )
}
