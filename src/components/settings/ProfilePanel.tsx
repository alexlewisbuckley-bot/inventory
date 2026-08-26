'use client'
import { useEffect, useTransition } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Monitor, ShieldCheck } from 'lucide-react'
import {
  Card, CardHeader, CardBody, CardFooter, Button, TextField, SelectField,
  Checkbox, Avatar, Chip, useToast,
} from '@/components/ui'
import { changePasswordAction } from '@/app/actions/auth'
import { signOutOtherDevicesAction, updatePreferencesAction } from '@/app/actions/admin'
import type { ActionState } from '@/app/actions/auth'
import { useTheme } from '@/components/ui/ThemeProvider'
import { RelativeTime } from '@/components/ui/RelativeTime'
import { ROLE_LABELS, ROLE_DESCRIPTIONS, THEMES, DENSITIES, CURRENCIES, type Role, type Theme } from '@/lib/enums'
import type { SessionUser } from '@/server/auth/session'

const INITIAL: ActionState = { ok: false }

export interface ProfilePreferences {
  theme: string
  density: string
  displayCurrency: string
  defaultLocationId: string
  emailNotifications: boolean
  inAppNotifications: boolean
}

export interface SessionSummary {
  id: string; userAgent: string | null; ipAddress: string | null
  lastSeenAt: string; createdAt: string; isCurrent: boolean
}

const THEME_LABELS: Record<string, string> = { LIGHT: 'Light', DARK: 'Dark', SYSTEM: 'Match my system' }
const DENSITY_LABELS: Record<string, string> = { COMFORTABLE: 'Comfortable', COMPACT: 'Compact' }

export function ProfilePanel({ user, preferences, locations, sessions }: {
  user: SessionUser
  preferences: ProfilePreferences
  locations: Array<{ id: string; name: string }>
  sessions: SessionSummary[]
}) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-3">
      {/* The identity card is a third the height of the column beside it, so it
          follows you down rather than leaving a long empty gutter. */}
      <div className="lg:sticky lg:top-[84px] lg:col-span-1">
        <Card>
          <CardBody className="flex flex-col items-center py-8 text-center">
            <Avatar initials={user.initials} id={user.id} size="lg" />
            <h2 className="mt-4 text-h3 font-extrabold text-content-primary">{user.name}</h2>
            <p className="text-small text-content-secondary">{user.email}</p>
            {user.jobTitle && <p className="mt-0.5 text-caption text-content-secondary">{user.jobTitle}</p>}
            <div className="mt-4">
              <Chip tone="accent">{ROLE_LABELS[user.role as Role]}</Chip>
            </div>
            <p className="mt-3 max-w-[240px] text-caption text-content-secondary">
              {ROLE_DESCRIPTIONS[user.role as Role]}
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-6 lg:col-span-2">
        <PreferencesForm preferences={preferences} locations={locations} />
        <PasswordForm />
        <SessionsCard sessions={sessions} />
      </div>
    </div>
  )
}

function PreferencesForm({ preferences, locations }: {
  preferences: ProfilePreferences
  locations: Array<{ id: string; name: string }>
}) {
  const toast = useToast()
  const { setTheme } = useTheme()
  const [state, action] = useFormState(updatePreferencesAction, INITIAL)

  useEffect(() => {
    if (state.ok) toast.success('Preferences saved')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  return (
    <Card as="section">
      <CardHeader title="Preferences" description="How the application looks and behaves for you." />
      <form action={action}>
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <SelectField
            name="theme" label="Theme" defaultValue={preferences.theme}
            hint="Applied immediately and remembered on this device."
            // Apply optimistically so the change is visible before the save.
            onChange={(e) => setTheme(e.target.value as Theme)}
            options={THEMES.map((t) => ({ value: t, label: THEME_LABELS[t]! }))}
          />
          <SelectField
            name="density" label="Table density" defaultValue={preferences.density}
            options={DENSITIES.map((d) => ({ value: d, label: DENSITY_LABELS[d]! }))}
          />
          <SelectField
            name="displayCurrency" label="Preferred currency" defaultValue={preferences.displayCurrency}
            hint="Both currencies are always stored; this is your default view."
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
          />
          <SelectField
            name="defaultLocationId" label="Default location" defaultValue={preferences.defaultLocationId}
            placeholder="No default"
            hint="Pre-selected when you add an item."
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
          />
          <div className="flex flex-col gap-3 sm:col-span-2">
            <Checkbox name="inAppNotifications" label="In-app notifications"
              hint="Stock added, sales recorded and watches moved by colleagues."
              defaultChecked={preferences.inAppNotifications} />
            <Checkbox name="emailNotifications" label="Email notifications"
              hint="A daily digest of anything you have not read."
              defaultChecked={preferences.emailNotifications} />
          </div>
        </CardBody>
        <CardFooter>
          <span />
          <SubmitButton label="Save preferences" />
        </CardFooter>
      </form>
    </Card>
  )
}

function PasswordForm() {
  const toast = useToast()
  const [state, action] = useFormState(changePasswordAction, INITIAL)

  useEffect(() => {
    if (state.ok && state.message) toast.success('Password changed', state.message)
    else if (!state.ok && state.message) toast.error('Could not change password', state.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <Card as="section">
      <CardHeader
        title="Password"
        description="Changing your password signs you out of every other device."
      />
      <form action={action}>
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <TextField name="currentPassword" type="password" label="Current password" required
            autoComplete="current-password" className="sm:col-span-2" error={state.errors?.currentPassword} />
          <TextField name="newPassword" type="password" label="New password" required
            autoComplete="new-password"
            hint="At least 10 characters, with upper and lower case and a number."
            error={state.errors?.newPassword} />
          <TextField name="confirmPassword" type="password" label="Confirm new password" required
            autoComplete="new-password" error={state.errors?.confirmPassword} />
        </CardBody>
        <CardFooter>
          <span />
          <SubmitButton label="Change password" />
        </CardFooter>
      </form>
    </Card>
  )
}

/**
 * Signed-in devices.
 *
 * Two things this list has to get right. The device you are reading it on
 * belongs at the top and says so, because every other row is only meaningful
 * relative to it. And the list is bounded: it used to render every row the
 * table held — fifty near-identical entries pushing the page past ten thousand
 * pixels — which hides the one unfamiliar device it exists to reveal.
 */
function SessionsCard({ sessions }: { sessions: SessionSummary[] }) {
  const toast = useToast()
  const [pending, start] = useTransition()

  // This device first; everything else by recency, which the query already did.
  const ordered = [...sessions].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))
  const others = sessions.filter((session) => !session.isCurrent).length

  const signOutOthers = () => {
    start(async () => {
      const result = await signOutOtherDevicesAction()
      if (result.ok) toast.success('Other devices signed out', result.message)
      else toast.error('Could not sign out the other devices', result.message)
    })
  }

  return (
    <Card as="section">
      <CardHeader
        title="Signed-in devices"
        description="Sessions currently valid for your account, most recently used first."
      />
      <ul className="divide-y divide-line-subtle">
        {ordered.length === 0 && (
          <li className="px-6 py-5 text-small text-content-secondary">No active sessions found.</li>
        )}
        {ordered.map((session) => (
          <li key={session.id} className="flex items-center gap-4 px-6 py-4">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                session.isCurrent ? 'bg-teal-500/10 text-teal-600' : 'bg-surface-subtle text-content-secondary'
              }`}
              aria-hidden
            >
              <Monitor className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-small font-bold text-content-primary">
                <span className="truncate">{describeAgent(session.userAgent)}</span>
                {session.isCurrent && <Chip tone="success">This device</Chip>}
              </p>
              <p className="truncate text-caption text-content-secondary">
                {session.ipAddress ?? 'Unknown address'} · last active <RelativeTime value={session.lastSeenAt} />
              </p>
            </div>
            <p className="hidden shrink-0 text-caption text-content-secondary sm:block">
              since <RelativeTime value={session.createdAt} />
            </p>
          </li>
        ))}
      </ul>
      <CardFooter>
        <p className="flex items-center gap-2 text-caption text-content-secondary">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
          Changing your password ends every session except this one.
        </p>
        <Button
          variant="secondary"
          onClick={signOutOthers}
          loading={pending}
          disabled={others === 0}
          title={others === 0 ? 'This is your only signed-in device.' : undefined}
        >
          Sign out other devices
        </Button>
      </CardFooter>
    </Card>
  )
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return <Button type="submit" loading={pending}>{label}</Button>
}

/** Best-effort, human-readable device description from a user-agent string. */
function describeAgent(agent: string | null): string {
  if (!agent) return 'Unknown device'
  const browser = /Edg\//.test(agent) ? 'Edge'
    : /Chrome\//.test(agent) ? 'Chrome'
    : /Safari\//.test(agent) && !/Chrome/.test(agent) ? 'Safari'
    : /Firefox\//.test(agent) ? 'Firefox'
    : 'Browser'
  const platform = /Macintosh|Mac OS/.test(agent) ? 'macOS'
    : /Windows/.test(agent) ? 'Windows'
    : /iPhone|iPad/.test(agent) ? 'iOS'
    : /Android/.test(agent) ? 'Android'
    : /Linux/.test(agent) ? 'Linux'
    : 'Unknown platform'
  return `${browser} on ${platform}`
}
