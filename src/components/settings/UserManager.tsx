'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { KeyRound, Pencil, Plus, Trash2, Users } from 'lucide-react'
import {
  Card, CardHeader, Table, THead, TBody, TR, TD, TH, Button, Modal, TextField,
  SelectField, Checkbox, Chip, Avatar, ConfirmDialog, EmptyState, useToast,
} from '@/components/ui'
import { createUserAction, updateUserAction, deleteUserAction, resetPasswordAction } from '@/app/actions/admin'
import type { ActionState } from '@/app/actions/auth'
import { relativeTime } from '@/lib/dates'
import { ROLE_LABELS, ROLE_DESCRIPTIONS, type Role } from '@/lib/enums'
import { ROLE_CAPABILITIES } from '@/lib/permissions'

export interface UserRowView {
  id: string; name: string; email: string; role: Role
  jobTitle: string | null; phone: string | null; initials: string
  isActive: boolean; lastLoginAt: string | null; activeSessions: number
}

const INITIAL: ActionState = { ok: false }

/** User directory with role management and administrative password reset. */
export function UserManager({ users, currentUserId, canManage, assignable }: {
  users: UserRowView[]
  currentUserId: string
  canManage: boolean
  assignable: Role[]
}) {
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<UserRowView | null>(null)
  const [resetting, setResetting] = useState<UserRowView | null>(null)
  const [deleting, setDeleting] = useState<UserRowView | null>(null)
  const [busy, setBusy] = useState(false)

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    const result = await deleteUserAction(deleting.id)
    setBusy(false)
    setDeleting(null)
    if (result.ok) toast.success('User removed', result.message)
    else toast.error('Could not remove user', result.message)
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader
            title="Users"
            description={`${users.length} ${users.length === 1 ? 'person has' : 'people have'} access to this system.`}
            action={canManage
              ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add user</Button>
              : undefined}
          />
          {users.length === 0 ? (
            <EmptyState icon={<Users className="h-6 w-6" />} title="No users" description="Add your first colleague to get started." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH width="150px">Role</TH>
                  <TH width="160px">Last signed in</TH>
                  <TH width="110px">Devices</TH>
                  <TH width="110px">Status</TH>
                  {canManage && <TH width="130px"><span className="sr-only">Actions</span></TH>}
                </TR>
              </THead>
              <TBody>
                {users.map((user) => (
                  <TR key={user.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar initials={user.initials} id={user.id} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-bold text-content-primary">
                            {user.name}
                            {user.id === currentUserId && <span className="ml-2 text-caption font-medium text-content-secondary">(you)</span>}
                          </p>
                          <p className="truncate text-caption text-content-secondary">{user.email}</p>
                        </div>
                      </div>
                    </TD>
                    <TD><Chip tone={user.role === 'OWNER' ? 'accent' : 'neutral'}>{ROLE_LABELS[user.role]}</Chip></TD>
                    <TD className="text-content-secondary">
                      {user.lastLoginAt ? relativeTime(user.lastLoginAt) : 'Never'}
                    </TD>
                    <TD className="text-content-secondary">{user.activeSessions}</TD>
                    <TD>
                      <Chip tone={user.isActive ? 'accent' : 'neutral'} dot={user.isActive}>
                        {user.isActive ? 'Active' : 'Disabled'}
                      </Chip>
                    </TD>
                    {canManage && (
                      <TD>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setEditing(user)} aria-label={`Edit ${user.name}`}
                            className="rounded-sm p-1.5 text-content-secondary hover:bg-surface-subtle hover:text-content-primary">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => setResetting(user)} aria-label={`Reset password for ${user.name}`}
                            className="rounded-sm p-1.5 text-content-secondary hover:bg-surface-subtle hover:text-content-primary">
                            <KeyRound className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => setDeleting(user)} aria-label={`Remove ${user.name}`}
                            disabled={user.id === currentUserId}
                            className="rounded-sm p-1.5 text-content-secondary hover:bg-state-danger/10 hover:text-state-danger disabled:opacity-30 disabled:pointer-events-none">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="What each role can do" description="Capabilities are additive — each role includes everything below it." />
          <ul className="divide-y divide-line-subtle">
            {(['OWNER', 'MANAGER', 'STAFF', 'VIEWER'] as Role[]).map((role) => (
              <li key={role} className="px-6 py-4">
                <div className="flex items-baseline gap-3">
                  <Chip tone={role === 'OWNER' ? 'accent' : 'neutral'}>{ROLE_LABELS[role]}</Chip>
                  <p className="text-small text-content-secondary">{ROLE_DESCRIPTIONS[role]}</p>
                </div>
                <p className="mt-2 text-caption text-content-secondary">
                  {ROLE_CAPABILITIES[role].length} capabilities
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <CreateUserModal open={creating} assignable={assignable}
        onClose={() => setCreating(false)}
        onSaved={(message) => { toast.success('User added', message); setCreating(false) }} />

      <EditUserModal user={editing} assignable={assignable}
        onClose={() => setEditing(null)}
        onSaved={() => { toast.success('User updated'); setEditing(null) }} />

      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)}
        onDone={(message) => { toast.success('Password reset', message); setResetting(null) }} />

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={busy}
        title={`Remove ${deleting?.name}?`}
        message="They will be signed out immediately and lose access. Their past activity stays in the audit trail."
        confirmLabel="Remove user"
      />
    </>
  )
}

function CreateUserModal({ open, assignable, onClose, onSaved }: {
  open: boolean; assignable: Role[]; onClose: () => void; onSaved: (message: string) => void
}) {
  const [state, action] = useFormState(createUserAction, INITIAL)
  const [seen, setSeen] = useState(false)
  if (state.ok && open && !seen) { setSeen(true); onSaved(state.message ?? 'Added') }
  if (!open && seen) setSeen(false)

  return (
    <Modal open={open} onClose={onClose} title="Add a user"
      description="They can sign in immediately with the password you set here."
      footer={<ModalFooter onClose={onClose} formId="create-user" label="Add user" />}>
      <form id="create-user" action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
        <TextField name="name" label="Full name" required error={state.errors?.name} />
        <TextField name="email" label="Email address" type="email" required error={state.errors?.email} />
        <TextField name="jobTitle" label="Job title" placeholder="e.g. Sales Associate — Dubai" />
        <TextField name="phone" label="Phone" />
        <SelectField name="role" label="Role" required className="sm:col-span-2"
          options={assignable.map((r) => ({ value: r, label: `${ROLE_LABELS[r]} — ${ROLE_DESCRIPTIONS[r]}` }))}
          error={state.errors?.role} />
        <TextField name="password" label="Temporary password" type="password" required className="sm:col-span-2"
          hint="At least 10 characters with upper and lower case and a number. Share it securely and ask them to change it."
          error={state.errors?.password} />
      </form>
    </Modal>
  )
}

function EditUserModal({ user, assignable, onClose, onSaved }: {
  user: UserRowView | null; assignable: Role[]; onClose: () => void; onSaved: () => void
}) {
  const [state, action] = useFormState(updateUserAction, INITIAL)
  const [seen, setSeen] = useState(false)
  if (state.ok && user && !seen) { setSeen(true); onSaved() }
  if (!user && seen) setSeen(false)
  if (!user) return null

  return (
    <Modal open onClose={onClose} title={`Edit ${user.name}`}
      description="Role changes take effect on their next request."
      footer={<ModalFooter onClose={onClose} formId="edit-user" label="Save changes" />}>
      <form id="edit-user" action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
        <input type="hidden" name="id" value={user.id} />
        <TextField name="name" label="Full name" defaultValue={user.name} required error={state.errors?.name} />
        <TextField name="jobTitle" label="Job title" defaultValue={user.jobTitle ?? ''} />
        <TextField name="phone" label="Phone" defaultValue={user.phone ?? ''} />
        <SelectField name="role" label="Role" defaultValue={user.role}
          options={assignable.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          error={state.errors?.role} />
        <div className="sm:col-span-2">
          <Checkbox name="isActive" label="Active"
            hint="Disabling signs them out immediately and blocks sign-in."
            defaultChecked={user.isActive} />
        </div>
        {state.message && !state.ok && (
          <p role="alert" className="sm:col-span-2 text-small text-state-danger">{state.message}</p>
        )}
      </form>
    </Modal>
  )
}

function ResetPasswordModal({ user, onClose, onDone }: {
  user: UserRowView | null; onClose: () => void; onDone: (message: string) => void
}) {
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const submit = async () => {
    setBusy(true)
    const result = await resetPasswordAction(user.id, password)
    setBusy(false)
    setPassword('')
    if (result.ok) onDone(result.message ?? '')
    else toast.error('Could not reset password', result.message)
  }

  return (
    <Modal open onClose={onClose} title={`Reset password for ${user.name}`}
      description="They will be signed out of every device and must use the new password."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={password.length < 10}>Reset password</Button>
        </>
      }>
      <TextField label="New password" type="password" value={password} autoFocus
        onChange={(e) => setPassword(e.target.value)}
        hint="At least 10 characters with upper and lower case and a number." />
    </Modal>
  )
}

function ModalFooter({ onClose, formId, label }: { onClose: () => void; formId: string; label: string }) {
  const { pending } = useFormStatus()
  return (
    <>
      <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
      <Button type="submit" form={formId} loading={pending}>{label}</Button>
    </>
  )
}
