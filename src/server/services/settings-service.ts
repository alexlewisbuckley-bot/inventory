import { eq, inArray } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { appSettings, userPreferences } from '../db/schema'
import { recordAudit } from './audit'
import { ValidationError } from '@/lib/errors'
import type { SessionUser } from '../auth/session'
import type { z } from 'zod'
import type { preferencesSchema } from '@/lib/validation'
import { SETTING_SPECS, type SettingSpec } from '@/lib/settings-specs'

export { SETTING_SPECS }
export type { SettingSpec }

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(appSettings)
    .where(inArray(appSettings.key, SETTING_SPECS.map((s) => s.key)))
  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}

export async function updateSettings(patch: Record<string, string>, actor: SessionUser): Promise<void> {
  const errors: Record<string, string> = {}
  for (const [key, value] of Object.entries(patch)) {
    const spec = SETTING_SPECS.find((s) => s.key === key)
    if (!spec) { errors[key] = 'Unknown setting.'; continue }
    const problem = spec.validate?.(value)
    if (problem) errors[key] = problem
  }
  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Some settings could not be saved.', errors)
  }

  const before = await getSettings()

  await withTransaction(async () => {
    for (const [key, value] of Object.entries(patch)) {
      await db.insert(appSettings).values({ key, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
    }
    const changes = Object.fromEntries(
      Object.entries(patch)
        .filter(([key, value]) => before[key] !== value)
        .map(([key, value]) => [key, { from: before[key] ?? null, to: value }]),
    )
    if (Object.keys(changes).length > 0) {
      await recordAudit({
        entityType: 'AppSetting', entityId: 'global', action: 'UPDATE', actorId: actor.id,
        summary: `${Object.keys(changes).length} setting(s) changed`, changes,
      })
    }
  })
}

export async function updatePreferences(
  userId: string,
  patch: z.infer<typeof preferencesSchema>,
): Promise<void> {
  await db.insert(userPreferences).values({ userId, ...patch })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { ...patch, updatedAt: new Date() } })
}

export async function getPreferencesFor(userId: string) {
  const rows = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1)
  return rows[0] ?? null
}
