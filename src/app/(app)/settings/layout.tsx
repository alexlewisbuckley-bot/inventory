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
      {/* Settings is reading and form-filling, not scanning a table, so it
          keeps a comfortable measure instead of stretching to the full canvas.
          Set here so every panel agrees — they were 3xl, 4xl and 5xl. */}
      <div className="max-w-5xl">{children}</div>
    </>
  )
}
