'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Card, Table, THead, TBody, TR, TD, TH, Button, Modal, TextField,
  TextareaField, Checkbox, Chip, ConfirmDialog, EmptyState, useToast,
} from '@/components/ui'
import { saveSupplierAction, deleteSupplierAction } from '@/app/actions/reference'
import type { ActionState } from '@/app/actions/auth'
import { formatMoney } from '@/lib/money'

export interface SupplierRow {
  id: string
  name: string
  contactName: string | null
  email: string | null
  phone: string | null
  country: string | null
  notes: string | null
  isActive: boolean
  watchCount: number
  totalCostGbp: number
  inStockCount: number
  soldCount: number
}

const INITIAL: ActionState = { ok: false }

/**
 * Supplier list with inline create/edit.
 *
 * Suppliers are a short list maintained rarely, so a modal over the table beats
 * dedicated create/edit routes — the user never loses sight of the list.
 */
export function SupplierManager({ suppliers, canManage }: { suppliers: SupplierRow[]; canManage: boolean }) {
  const toast = useToast()
  const [editing, setEditing] = useState<SupplierRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<SupplierRow | null>(null)
  const [busy, setBusy] = useState(false)

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    const result = await deleteSupplierAction(deleting.id)
    setBusy(false)
    setDeleting(null)
    if (result.ok) toast.success('Supplier deleted')
    else toast.error('Could not delete supplier', result.message)
  }

  return (
    <>
      {canManage && (
        <div className="mb-6 flex justify-end">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add supplier</Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {suppliers.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="No suppliers yet"
            description="Add the dealers and private sellers you buy from so purchases can be attributed."
            action={canManage ? <Button onClick={() => setCreating(true)}>Add supplier</Button> : undefined}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Supplier</TH>
                <TH width="160px">Contact</TH>
                <TH width="120px">Country</TH>
                <TH width="100px" align="right">Purchased</TH>
                <TH width="100px" align="right">In stock</TH>
                <TH width="130px" align="right">Total spend</TH>
                <TH width="100px">Status</TH>
                {canManage && <TH width="96px"><span className="sr-only">Actions</span></TH>}
              </TR>
            </THead>
            <TBody>
              {suppliers.map((supplier) => (
                <TR key={supplier.id}>
                  <TD>
                    <span className="block font-bold text-content-primary">{supplier.name}</span>
                    {supplier.email && <span className="block text-caption text-content-secondary">{supplier.email}</span>}
                  </TD>
                  <TD className="text-content-secondary">{supplier.contactName ?? '—'}</TD>
                  <TD className="text-content-secondary">{supplier.country ?? '—'}</TD>
                  <TD align="right">
                    <Link href={`/inventory?supplierId=${supplier.id}`} className="font-bold text-navy-700 hover:underline">
                      {supplier.watchCount}
                    </Link>
                  </TD>
                  <TD align="right" className="text-content-secondary">{supplier.inStockCount}</TD>
                  <TD align="right" className="font-bold">{formatMoney(supplier.totalCostGbp, 'GBP')}</TD>
                  <TD>
                    <Chip tone={supplier.isActive ? 'accent' : 'neutral'} dot={supplier.isActive}>
                      {supplier.isActive ? 'Active' : 'Inactive'}
                    </Chip>
                  </TD>
                  {canManage && (
                    <TD>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setEditing(supplier)} aria-label={`Edit ${supplier.name}`}
                          className="rounded-sm p-1.5 text-content-secondary hover:bg-surface-subtle hover:text-content-primary">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => setDeleting(supplier)} aria-label={`Delete ${supplier.name}`}
                          className="rounded-sm p-1.5 text-content-secondary hover:bg-state-danger/10 hover:text-state-danger">
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

      <SupplierFormModal
        open={creating || editing !== null}
        supplier={editing}
        onClose={() => { setCreating(false); setEditing(null) }}
        onSaved={(message) => { toast.success(message); setCreating(false); setEditing(null) }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={busy}
        title={`Delete ${deleting?.name}?`}
        message={
          deleting && deleting.watchCount > 0
            ? `${deleting.name} has ${deleting.watchCount} watches against it, so it cannot be deleted. Deactivate it instead to hide it from new purchases.`
            : 'The supplier will be removed from the list. Past purchases keep their history.'
        }
        confirmLabel="Delete supplier"
      />
    </>
  )
}

function SupplierFormModal({ open, supplier, onClose, onSaved }: {
  open: boolean
  supplier: SupplierRow | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [state, action] = useFormState(saveSupplierAction, INITIAL)
  const [wasOpen, setWasOpen] = useState(false)

  // Fire the success callback exactly once per successful submit.
  if (state.ok && open && !wasOpen) {
    setWasOpen(true)
    onSaved(state.message ?? 'Saved')
  }
  if (!open && wasOpen) setWasOpen(false)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={supplier ? `Edit ${supplier.name}` : 'Add a supplier'}
      description="Suppliers are attributed to every watch you buy, and drive the supplier performance report."
      footer={<SupplierFooter onClose={onClose} isEdit={Boolean(supplier)} formId="supplier-form" />}
    >
      <form id="supplier-form" action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
        {supplier && <input type="hidden" name="id" value={supplier.id} />}
        <TextField name="name" label="Supplier name" required defaultValue={supplier?.name ?? ''}
          className="sm:col-span-2" error={state.errors?.name} />
        <TextField name="contactName" label="Contact name" defaultValue={supplier?.contactName ?? ''} />
        <TextField name="email" label="Email" type="email" defaultValue={supplier?.email ?? ''} error={state.errors?.email} />
        <TextField name="phone" label="Phone" defaultValue={supplier?.phone ?? ''} />
        <TextField name="country" label="Country" defaultValue={supplier?.country ?? ''} />
        <TextareaField name="notes" label="Notes" className="sm:col-span-2" defaultValue={supplier?.notes ?? ''}
          placeholder="Terms, typical lead times, anything worth remembering" />
        <div className="sm:col-span-2">
          <Checkbox name="isActive" label="Active"
            hint="Inactive suppliers stay on past purchases but cannot be chosen for new stock."
            defaultChecked={supplier?.isActive ?? true} />
        </div>
      </form>
    </Modal>
  )
}

function SupplierFooter({ onClose, isEdit, formId }: { onClose: () => void; isEdit: boolean; formId: string }) {
  const { pending } = useFormStatus()
  return (
    <>
      <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
      <Button type="submit" form={formId} loading={pending}>{isEdit ? 'Save changes' : 'Add supplier'}</Button>
    </>
  )
}
