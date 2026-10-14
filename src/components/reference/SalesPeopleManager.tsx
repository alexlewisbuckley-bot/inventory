'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Pencil, Trash2, UserPlus } from 'lucide-react'
import {
  Card, Button, Modal, TextField, SelectField, Checkbox, Chip, ConfirmDialog,
  Table, THead, TBody, TR, TD, TH, useToast, useCreateFlag, useCurrency,
} from '@/components/ui'
import { saveSalesPersonAction, deleteSalesPersonAction } from '@/app/actions/reference'
import type { ActionState } from '@/app/actions/auth'
import { moneyPrefix } from '@/lib/currency'
import { formatShare } from '@/lib/money'
import { BASE_CURRENCY } from '@/lib/enums'

export interface SalesPersonRow {
  id: string
  name: string
  isActive: boolean
  /** Base minor units. */
  retainer: number
  commissionBps: number
  userId: string | null
  userName: string | null
  userEmail: string | null
  soldCount: number
}

export interface LinkableUser {
  id: string
  name: string
  email: string
}

const INITIAL: ActionState = { ok: false }

/**
 * The people who sell.
 *
 * A table rather than cards: unlike owners or locations there is nothing to
 * say about each one beyond a name, an account and a count, and six rows of
 * cards for three facts each is a lot of screen for a list.
 *
 * The account link is what makes "my sales" mean anything — without it there
 * is no way to tell which salesperson a signed-in reader is, so their own
 * report has nothing to show them. It is optional in both directions on
 * purpose: people who sell may have no login, and logins may belong to
 * nobody on the shop floor.
 */
export function SalesPeopleManager({ people, users, canManage }: {
  people: SalesPersonRow[]
  users: LinkableUser[]
  canManage: boolean
}) {
  const toast = useToast()
  const { money } = useCurrency()
  const [editing, setEditing] = useState<SalesPersonRow | null>(null)
  const create = useCreateFlag()
  const [deleting, setDeleting] = useState<SalesPersonRow | null>(null)
  const [busy, setBusy] = useState(false)

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    const result = await deleteSalesPersonAction(deleting.id)
    setBusy(false)
    const had = deleting.soldCount > 0
    setDeleting(null)
    if (result.ok) {
      toast.success(
        had ? 'Deactivated instead of removed' : 'Removed',
        had ? 'They have sales against them, so the name is kept and no longer offered.' : undefined,
      )
    } else {
      toast.error('Could not remove that person', result.message)
    }
  }

  return (
    <>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <Button icon={<UserPlus className="h-4 w-4" />} onClick={create.openIt}>
            Add a person
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        <Table layout="fixed" minWidth="860px">
          <THead>
            <TR>
              <TH width="180px">Name</TH>
              <TH width="240px">Signs in as</TH>
              <TH width="140px" align="right">Retainer</TH>
              <TH width="90px" align="right">Share</TH>
              <TH width="80px" align="right">Sold</TH>
              <TH width="110px">Status</TH>
              {canManage && <TH align="right"><span className="sr-only">Actions</span></TH>}
            </TR>
          </THead>
          <TBody>
            {people.map((person) => (
              <TR key={person.id}>
                <TD className="font-bold text-content-primary">{person.name}</TD>
                <TD className="text-content-secondary">
                  {person.userName ? (
                    <>
                      <span className="block truncate text-content-primary">{person.userName}</span>
                      <span className="block truncate text-caption">{person.userEmail}</span>
                    </>
                  ) : (
                    // Said plainly, because the consequence is invisible
                    // otherwise: this person cannot see their own figures.
                    <span className="text-content-muted">Not linked — cannot see their own sales</span>
                  )}
                </TD>
                <TD align="right" className="tabular-nums">
                  {person.retainer > 0 ? money(person.retainer) : <span className="text-content-muted">None</span>}
                </TD>
                <TD align="right" className="tabular-nums text-content-secondary">
                  {formatShare(person.commissionBps)}
                </TD>
                <TD align="right" className="tabular-nums text-content-secondary">{person.soldCount}</TD>
                <TD>
                  <Chip tone={person.isActive ? 'success' : 'neutral'}>
                    {person.isActive ? 'Active' : 'Inactive'}
                  </Chip>
                </TD>
                {canManage && (
                  <TD align="right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost" size="sm"
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => setEditing(person)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        icon={<Trash2 className="h-4 w-4" />}
                        onClick={() => setDeleting(person)}
                      >
                        <span className="sr-only">Remove {person.name}</span>
                      </Button>
                    </div>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <PersonModal
        open={create.open || editing !== null}
        person={editing}
        users={users}
        onClose={() => { setEditing(null); create.close() }}
        onSaved={() => { setEditing(null); create.close() }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={deleting && deleting.soldCount > 0 ? 'Deactivate this person?' : 'Remove this person?'}
        message={deleting && deleting.soldCount > 0
          ? `${deleting.name} has ${deleting.soldCount} ${deleting.soldCount === 1 ? 'sale' : 'sales'} against them, so the name is kept and simply stops being offered. Deleting it would take the attribution off every one of those sales.`
          : `${deleting?.name ?? ''} has never been named on a sale, so there is nothing to lose by removing them.`}
        confirmLabel={deleting && deleting.soldCount > 0 ? 'Deactivate' : 'Remove'}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        loading={busy}
        tone="danger"
      />
    </>
  )
}

function PersonModal({ open, person, users, onClose, onSaved }: {
  open: boolean
  person: SalesPersonRow | null
  users: LinkableUser[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [state, action] = useFormState(saveSalesPersonAction, INITIAL)
  const [lastHandled, setLastHandled] = useState<ActionState | null>(null)

  if (state !== lastHandled && state.ok) {
    setLastHandled(state)
    toast.success(state.message ?? 'Saved')
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={person ? `Edit ${person.name}` : 'Add a person'} size="md">
      <form action={action} className="flex flex-col gap-4">
        {person && <input type="hidden" name="id" value={person.id} />}
        <TextField
          label="Name"
          name="name"
          required
          autoFocus
          defaultValue={person?.name ?? ''}
          error={state.errors?.name}
          hint="As it should read on a sale and in the reports."
        />
        <SelectField
          label="Signs in as"
          name="userId"
          defaultValue={person?.userId ?? ''}
          placeholder="Not linked"
          options={users.map((user) => ({ value: user.id, label: `${user.name} · ${user.email}` }))}
          error={state.errors?.userId}
          hint="Linking an account lets them see their own sales — and only their own. Leave it blank for somebody who does not sign in."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Monthly retainer"
            name="retainer"
            inputMode="decimal"
            prefix={moneyPrefix(BASE_CURRENCY)}
            defaultValue={person && person.retainer > 0 ? String(person.retainer / 100) : ''}
            error={state.errors?.retainer}
            hint="Paid every month whatever they sell."
          />
          <TextField
            label="Share above it"
            name="commissionPct"
            inputMode="decimal"
            defaultValue={person ? String(person.commissionBps / 100) : '25'}
            error={state.errors?.commissionPct}
            hint="Of the profit on their own sales, once the month clears the retainer."
          />
        </div>
        <Checkbox
          name="isActive"
          defaultChecked={person ? person.isActive : true}
          label="Offer this person when a sale is booked"
          hint="Turning it off keeps their past sales in the reports and stops them appearing in the list."
        />
        {state.errors?.form && (
          <p role="alert" className="text-caption text-state-danger">{state.errors.form}</p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Save label={person ? 'Save' : 'Add'} />
        </div>
      </form>
    </Modal>
  )
}

function Save({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return <Button type="submit" loading={pending}>{label}</Button>
}
