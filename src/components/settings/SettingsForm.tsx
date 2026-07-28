'use client'
import { useEffect } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Lock } from 'lucide-react'
import { Card, CardHeader, CardBody, CardFooter, Button, TextField, useToast } from '@/components/ui'
import { updateSettingsAction } from '@/app/actions/admin'
import type { ActionState } from '@/app/actions/auth'

/**
 * The serialisable half of a SettingSpec.
 *
 * `SettingSpec.validate` is a function, and functions cannot cross the
 * server/client boundary — passing the full spec crashed this page with
 * "Functions cannot be passed directly to Client Components". Validation is a
 * server concern anyway; the client only needs the labels.
 */
export interface SettingField {
  key: string
  label: string
  description: string
  group: string
  type: 'text' | 'number' | 'currency'
}

const INITIAL: ActionState = { ok: false }

/**
 * Application settings, grouped by concern.
 *
 * Read-only roles see the same values rather than a blank page — knowing the
 * FX rate matters even if you cannot change it.
 */
export function SettingsForm({ specs, values, canManage }: {
  specs: SettingField[]
  values: Record<string, string>
  canManage: boolean
}) {
  const toast = useToast()
  const [state, action] = useFormState(updateSettingsAction, INITIAL)

  useEffect(() => {
    if (state.ok && state.message) toast.success('Settings saved', state.message)
    else if (!state.ok && state.message) toast.error('Could not save', state.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const groups = [...new Set(specs.map((s) => s.group))]

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-6" noValidate>
      {!canManage && (
        <div className="flex items-start gap-2.5 rounded-md border border-line-subtle bg-surface-subtle px-4 py-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
          <p className="text-small text-content-secondary">
            These settings are read-only for your role. An owner can change them.
          </p>
        </div>
      )}

      {groups.map((group) => (
        <Card key={group}>
          <CardHeader title={group} />
          <CardBody className="flex flex-col gap-5">
            {specs.filter((spec) => spec.group === group).map((spec) => (
              <TextField
                key={spec.key}
                name={spec.key}
                label={spec.label}
                hint={spec.description}
                defaultValue={values[spec.key] ?? ''}
                disabled={!canManage}
                inputMode={spec.type === 'number' ? 'decimal' : undefined}
                error={state.errors?.[spec.key]}
              />
            ))}
          </CardBody>
        </Card>
      ))}

      {canManage && (
        <Card>
          <CardFooter>
            <p className="text-caption text-content-secondary">
              Changes apply to new records. Historic purchases keep the rate captured at the time.
            </p>
            <SaveButton />
          </CardFooter>
        </Card>
      )}
    </form>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()
  return <Button type="submit" loading={pending}>Save settings</Button>
}
