'use client'

import { SelectField, TextField } from '@/components/ui'
import { Composer } from './Composer'
import { saveTaskAction } from '@/app/actions/crm'
import { PRIORITIES, PRIORITY_LABELS, TASK_KINDS, TASK_KIND_LABELS } from '@/lib/enums'

/**
 * Adding a follow-up, without leaving whatever you were reading.
 *
 * The server could create tasks from the day the CRM shipped; nothing in the
 * interface could. Four fields, of which one is required — a title. Everything
 * else has a default that is right most of the time, because a create form that
 * demands six decisions is a create form people work around by writing it on
 * a pad.
 *
 * "Tomorrow" rather than today is the default date. A follow-up you set for
 * yourself while on the phone is almost never for the next ten minutes, and an
 * empty date means it never surfaces in a group anybody looks at.
 */
export function TaskComposer({ can, assignees, scope, label = 'Add a follow-up' }: {
  can: boolean
  assignees: Array<{ id: string; name: string }>
  /** What the task hangs off — a customer, a watch, a deal, a request. */
  scope?: {
    customerId?: string | null
    watchId?: string | null
    dealId?: string | null
    supplierId?: string | null
    requestId?: string | null
  }
  label?: string
}) {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const defaultDue = tomorrow.toISOString().slice(0, 10)

  return (
    <Composer
      action={saveTaskAction}
      can={can}
      label={label}
      submitLabel="Add task"
      scope={{
        customerId: scope?.customerId ?? undefined,
        watchId: scope?.watchId ?? undefined,
        dealId: scope?.dealId ?? undefined,
        supplierId: scope?.supplierId ?? undefined,
        requestId: scope?.requestId ?? undefined,
      }}
      fields={(state) => (
        <>
          <TextField
            name="title"
            label="What needs doing"
            required
            maxLength={160}
            placeholder="Call back about the Daytona"
            error={state.errors?.title}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="dueAt" type="date" label="Due" defaultValue={defaultDue} />
            <SelectField
              name="kind"
              label="Kind"
              defaultValue="FOLLOW_UP"
              options={TASK_KINDS.map((kind) => ({ value: kind, label: TASK_KIND_LABELS[kind] }))}
            />
            <SelectField
              name="priority"
              label="Priority"
              defaultValue="NORMAL"
              options={PRIORITIES.map((priority) => ({
                value: priority, label: PRIORITY_LABELS[priority],
              }))}
            />
            <SelectField
              name="assigneeId"
              label="Who"
              placeholder="You"
              options={assignees.map((user) => ({ value: user.id, label: user.name }))}
            />
          </div>
        </>
      )}
    />
  )
}
