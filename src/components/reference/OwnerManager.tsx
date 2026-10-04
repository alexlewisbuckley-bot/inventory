'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { Building2, Pencil, Trash2, User } from 'lucide-react'
import {
  Card, Button, Modal, TextField, TextareaField, SelectField, Checkbox,
  Chip, ConfirmDialog, EmptyState, useToast, useCreateFlag, useCurrency,
} from '@/components/ui'
import { saveOwnerAction, deleteOwnerAction } from '@/app/actions/reference'
import type { ActionState } from '@/app/actions/auth'
import { OWNER_TYPES, OWNER_TYPE_LABELS, type OwnerType } from '@/lib/enums'
import { heldByQuery } from '@/components/inventory/views'

export interface OwnerRow {
  id: string
  name: string
  type: OwnerType
  legalName: string | null
  registrationNo: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  notes: string | null
  isActive: boolean
  watchCount: number
  valueGbp: number
}

const INITIAL: ActionState = { ok: false }

/**
 * The owner register.
 *
 * Cards rather than a table for the same reason locations are: there are only
 * ever a handful, and each carries a holding and a capital figure that a table
 * row would flatten.
 */
export function OwnerManager({ owners, unownedCount, canManage }: {
  owners: OwnerRow[]
  unownedCount: number
  canManage: boolean
}) {
  const toast = useToast()
  const { money } = useCurrency()
  const [editing, setEditing] = useState<OwnerRow | null>(null)
  const create = useCreateFlag()
  const [deleting, setDeleting] = useState<OwnerRow | null>(null)
  const [busy, setBusy] = useState(false)

  const totalValue = owners.reduce((sum, o) => sum + o.valueGbp, 0)

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    const result = await deleteOwnerAction(deleting.id)
    setBusy(false)
    setDeleting(null)
    if (result.ok) toast.success('Owner deleted')
    else toast.error('Could not delete owner', result.message)
  }

  return (
    <>
      {/* Stock nobody has claimed yet is a worklist, not a warning. It is shown
          as a way in to the rows that need answering rather than as a red
          number sitting on the page. */}
      {unownedCount > 0 && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
            <p className="text-small text-content-secondary">
              <span className="font-bold text-content-primary">{unownedCount}</span>
              {unownedCount === 1 ? ' watch has' : ' watches have'} no owner recorded.
            </p>
            <Link href="/inventory?f=ownerId%3AisEmpty" className="text-small font-bold text-content-accent hover:underline">
              Assign them →
            </Link>
          </div>
        </Card>
      )}

      {owners.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="No owners yet"
            description="Add the companies and people whose stock you hold, so every watch can say whose it is."
            action={canManage ? <Button onClick={() => create.openIt()}>Add owner</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {owners.map((owner) => {
            const share = totalValue > 0 ? (owner.valueGbp / totalValue) * 100 : 0
            const Icon = owner.type === 'INDIVIDUAL' ? User : Building2
            return (
              <Card key={owner.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-3 px-6 pt-5">
                  <div className="min-w-0">
                    <h2 className="truncate text-h3 font-extrabold text-content-primary">{owner.name}</h2>
                    {/* Two lines reserved, as on the location cards, so the
                        figures beneath line up across the row. */}
                    <p className="mt-0.5 line-clamp-2 min-h-[2.4em] text-caption text-content-secondary">
                      <Icon className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
                      {[
                        OWNER_TYPE_LABELS[owner.type],
                        owner.legalName && owner.legalName !== owner.name ? owner.legalName : null,
                        owner.registrationNo,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Chip tone={owner.isActive ? 'accent' : 'neutral'} dot={owner.isActive}>
                    {owner.isActive ? 'Active' : 'Inactive'}
                  </Chip>
                </div>

                <div className="flex items-end gap-8 px-6 pt-5">
                  <div>
                    <p className="text-caption font-semibold text-content-secondary">Watches</p>
                    <p className="mt-1 text-h2 font-extrabold tabular-nums text-content-primary">{owner.watchCount}</p>
                  </div>
                  <div>
                    <p className="text-caption font-semibold text-content-secondary">Capital held</p>
                    <p className="mt-1 text-h3 font-extrabold tabular-nums text-content-primary">
                      {money(owner.valueGbp)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 px-6">
                  <div className="h-1.5 overflow-hidden rounded-pill bg-surface-subtle" role="presentation">
                    <div className="h-full rounded-pill bg-teal-500" style={{ width: `${Math.max(share, share > 0 ? 4 : 0)}%` }} />
                  </div>
                  <p className="mt-1.5 text-micro text-content-secondary">
                    {share.toFixed(0)}% of capital across all owners
                  </p>
                </div>

                {(owner.contactName || owner.contactEmail || owner.contactPhone) && (
                  <p className="mt-4 px-6 text-caption text-content-secondary">
                    {[owner.contactName, owner.contactEmail, owner.contactPhone].filter(Boolean).join(' · ')}
                  </p>
                )}
                {owner.notes && <p className="mt-2 px-6 text-caption text-content-secondary">{owner.notes}</p>}

                <div className="mt-auto flex items-center justify-between gap-2 border-t border-line-subtle px-6 py-3.5">
                  <Link href={`/inventory?${heldByQuery('ownerId', owner.id)}`} className="text-small font-bold text-content-accent hover:underline">
                    View stock →
                  </Link>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setEditing(owner)} aria-label={`Edit ${owner.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-subtle hover:text-content-primary">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setDeleting(owner)} aria-label={`Delete ${owner.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-sm text-content-secondary hover:bg-state-danger/10 hover:text-state-danger">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <OwnerFormModal
        open={create.open || editing !== null}
        owner={editing}
        onClose={() => { create.close(); setEditing(null) }}
        onSaved={(message) => { toast.success(message); create.close(); setEditing(null) }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={busy}
        title={`Delete ${deleting?.name}?`}
        message={
          deleting && deleting.watchCount > 0
            ? `${deleting.name} still owns ${deleting.watchCount} watches. Reassign them first, or deactivate the owner instead.`
            : 'The owner will be removed. Watches sold on their behalf keep their history.'
        }
        confirmLabel="Delete owner"
      />
    </>
  )
}

function OwnerFormModal({ open, owner, onClose, onSaved }: {
  open: boolean
  owner: OwnerRow | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [state, action] = useFormState(saveOwnerAction, INITIAL)
  const [wasOpen, setWasOpen] = useState(false)

  if (state.ok && open && !wasOpen) {
    setWasOpen(true)
    onSaved(state.message ?? 'Saved')
  }
  if (!open && wasOpen) setWasOpen(false)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={owner ? `Edit ${owner.name}` : 'Add an owner'}
      description="Owners appear on the intake form and on every stock row."
      footer={<OwnerFooter onClose={onClose} isEdit={Boolean(owner)} formId="owner-form" />}
    >
      <form id="owner-form" action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
        {owner && <input type="hidden" name="id" value={owner.id} />}
        <TextField name="name" label="Owner name" required defaultValue={owner?.name ?? ''}
          className="sm:col-span-2" error={state.errors?.name} placeholder="e.g. Bluecroft Traders Limited" />
        <SelectField name="type" label="Type" defaultValue={owner?.type ?? 'BUSINESS'}
          options={OWNER_TYPES.map((t) => ({ value: t, label: OWNER_TYPE_LABELS[t] }))} />
        <TextField name="registrationNo" label="Registration no." defaultValue={owner?.registrationNo ?? ''}
          hint="Companies only — leave blank for an individual." />
        <TextField name="legalName" label="Registered name" className="sm:col-span-2"
          defaultValue={owner?.legalName ?? ''} hint="Where it differs from the name used day to day." />
        <TextField name="contactName" label="Contact" defaultValue={owner?.contactName ?? ''} />
        <TextField name="contactPhone" label="Phone" defaultValue={owner?.contactPhone ?? ''} />
        <TextField name="contactEmail" label="Email" type="email" className="sm:col-span-2"
          defaultValue={owner?.contactEmail ?? ''} error={state.errors?.contactEmail} />
        <TextareaField name="notes" label="Notes" className="sm:col-span-2" defaultValue={owner?.notes ?? ''}
          placeholder="e.g. Stock held on consignment — settle monthly" />
        <div className="sm:col-span-2">
          <Checkbox name="isActive" label="Active"
            hint="Inactive owners cannot be assigned new stock but keep their history."
            defaultChecked={owner?.isActive ?? true} />
        </div>
      </form>
    </Modal>
  )
}

function OwnerFooter({ onClose, isEdit, formId }: { onClose: () => void; isEdit: boolean; formId: string }) {
  const { pending } = useFormStatus()
  return (
    <>
      <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
      <Button type="submit" form={formId} loading={pending}>{isEdit ? 'Save changes' : 'Add owner'}</Button>
    </>
  )
}
