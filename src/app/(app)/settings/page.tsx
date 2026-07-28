import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { getSettings, SETTING_SPECS } from '@/server/services/settings-service'
import { SettingsForm } from '@/components/settings/SettingsForm'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Application settings' }
export const dynamic = 'force-dynamic'

export default async function ApplicationSettingsPage() {
  const user = await requireCapability('settings:read')
  const values = await getSettings()

  return (
    <SettingsForm
      specs={SETTING_SPECS}
      values={values}
      canManage={can(user.role, 'settings:manage')}
    />
  )
}
