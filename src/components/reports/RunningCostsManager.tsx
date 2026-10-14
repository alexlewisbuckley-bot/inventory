'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import {
  Card, Button, Modal, TextField, SelectField, TextareaField, Checkbox, Chip, ConfirmDialog,
  EmptyState, Table, THead, TBody, TR, TD, TH, useToast, useCreateFlag, useCurrency,
} from '@/components/ui'
import { saveOverheadAction, deleteOverheadAction } from '@/app/actions/overheads'
import type { ActionState } from '@/app/actions/auth'
import { moneyPrefix } from '@/lib/currency'
import {
  BASE_CURRENCY, OVERHEAD_CADENCES, OVERHEAD_CADENCE_LABELS,
  OVERHEAD_CATEGORIES, OVERHEAD_CATEGORY_LABELS,
  type OverheadCadence, type OverheadCategory,
} from '@/lib/enums'

export interface CostRow {
  id: string
  name: string
  category: OverheadCategory
  /** Base minor units, per occurrence. */
  amount: number
  cadence: OverheadCadence
  /** What it works out at per month. */
  monthly: number
  startsOn: string
  endsOn: string | null
  notes: string | null
  isActive: boolean
  /** Whether it applied to the month on screen. */
  current: boolean
}

const INITIAL: ActionState = { ok: false }

/**
 * Everything the business pays that is not a watch.
 *
 * A table, and an editable one, because this is the only place these
 * numbers exist — unlike suppliers or locations there is no other screen
 * that creates them, and sending somebody to a separate settings page to
 * type a rent they are looking at a column of would be an odd walk.
 *
 * What is deliberately absent: a salesperson's retainer. Those are held
 * against each person on Sales people and read from there, so a wage cannot
 * be entered twice and the P&L cannot drift from the commission report.
 */
export function RunningCostsManager({ costs, canManage }: {
  costs: CostRow[]
  canManage: boolean
}) {
  const toast = useToast()
  const { money } = useCurrency()
  const [editing, setEditing] = useState<CostRow | null>(null)
  const create = useCreateFlag()
  const [deleting, setDeleting] = useState<CostRow | null>(null)
  const [busy, setBusy] = useState(false)

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    const result = await deleteOverheadAction(deleting.id)
    setBusy(false)
    setDeleting(null)
    if (result.ok) toast.success('Removed')
    else toast.error('Could not remove that cost', result.message)
  }

  return (
    <>
      {canManage && costs.length > 0 && (
        <div className="mb-4 flex justify-end">
          <Button icon={<Plus className="h-4 w-4" />} onClick={create.openIt}>Add a cost</Button>
        </div>
      )}

      {costs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Receipt className="h-6 w-6" />}
            title="No running costs recorded"
            description="Rent, insurance, software, salaries outside the sales floor — anything the business pays that is not a watch. Until they are in here, the profit and loss can only get as far as gross profit."
            action={canManage
              ? <Button icon={<Plus className="h-4 w-4" />} onClick={create.openIt}>Add a cost</Button>
              : undefined}
          />
        </Card>
      ) : (
      <Card className="overflow-hidden">
        <Table layout="fixed" minWidth="940px">
          <THead>
            <TR>
              <TH width="220px">Cost</TH>
              <TH width="190px">Category</TH>
              <TH width="140px" align="right">Amount</TH>
              <TH width="130px">How often</TH>
              <TH width="140px" align="right">Per month</TH>
              <TH width="150px">Running</TH>
              {canManage && <TH align="right"><span className="sr-only">Actions</span></TH>}
            </TR>
          </THead>
          <TBody>
            {costs.map((cost) => (
              <TR key={cost.id}>
                <TD className="font-bold text-content-primary">
                  {cost.name}
                  {cost.notes && (
                    <span className="block truncate text-caption font-normal text-content-secondary">
                      {cost.notes}
                    </span>
                  )}
                </TD>
                <TD className="text-content-secondary">{OVERHEAD_CATEGORY_LABELS[cost.category]}</TD>
                <TD align="right" className="tabular-nums">{money(cost.amount)}</TD>
                <TD className="text-content-secondary">{OVERHEAD_CADENCE_LABELS[cost.cadence]}</TD>
                <TD align="right" className="tabular-nums font-bold">
                  {/* A quarter's rent is stored as the quarter's figure, so
                      this column is the only one that can be added up. */}
                  {cost.current ? money(cost.monthly) : <span className="font-normal text-content-muted">—</span>}
                </TD>
                <TD>
                  {!cost.isActive ? (
                    <Chip tone="neutral">Stopped</Chip>
                  ) : cost.endsOn ? (
                    <span className="text-caption text-content-secondary">
                      until {formatDay(cost.endsOn)}
                    </span>
                  ) : (
                    <span className="text-caption text-content-secondary">
                      since {formatDay(cost.startsOn)}
                    </span>
                  )}
                </TD>
                {canManage && (
                  <TD align="right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" />}
                        onClick={() => setEditing(cost)}>Edit</Button>
                      <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />}
                        onClick={() => setDeleting(cost)}>
                        <span className="sr-only">Remove {cost.name}</span>
                      </Button>
                    </div>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      )}

      <CostModal
        open={create.open || editing !== null}
        cost={editing}
        onClose={() => { setEditing(null); create.close() }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Remove this cost?"
        message={`${deleting?.name ?? ''} will come off every month's profit and loss, including the months you already paid it in. If it simply stopped, give it an end date instead — that keeps the history honest.`}
        confirmLabel="Remove"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        loading={busy}
        tone="danger"
      />
    </>
  )
}

/** A plain date, read as a person says it. */
function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

function CostModal({ open, cost, onClose }: {
  open: boolean
  cost: CostRow | null
  onClose: () => void
}) {
  const toast = useToast()
  const [state, action] = useFormState(saveOverheadAction, INITIAL)
  const [lastHandled, setLastHandled] = useState<ActionState | null>(null)

  if (state !== lastHandled && state.ok) {
    setLastHandled(state)
    toast.success(state.message ?? 'Saved')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={cost ? `Edit ${cost.name}` : 'Add a running cost'} size="md">
      <form action={action} className="flex flex-col gap-4">
        {cost && <input type="hidden" name="id" value={cost.id} />}
        <TextField
          label="What is it" name="name" required autoFocus
          defaultValue={cost?.name ?? ''}
          error={state.errors?.name}
          hint="As you would say it on a bank statement — “Shop rent”, “Insurance”."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Category" name="category" required
            defaultValue={cost?.category ?? 'OTHER'}
            options={OVERHEAD_CATEGORIES.map((value) => ({ value, label: OVERHEAD_CATEGORY_LABELS[value] }))}
            error={state.errors?.category}
          />
          <TextField
            label="Amount" name="amount" required inputMode="decimal"
            prefix={moneyPrefix(BASE_CURRENCY)}
            defaultValue={cost ? String(cost.amount / 100) : ''}
            error={state.errors?.amount}
            hint="What the invoice says, not what it comes to per month."
          />
        </div>
        <SelectField
          label="How often" name="cadence" required
          defaultValue={cost?.cadence ?? 'MONTHLY'}
          options={OVERHEAD_CADENCES.map((value) => ({ value, label: OVERHEAD_CADENCE_LABELS[value] }))}
          error={state.errors?.cadence}
          hint="A quarterly or yearly bill is spread across its months, so twelve months can be compared. A one-off lands in its own month alone."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Started" name="startsOn" type="date" required
            defaultValue={cost?.startsOn ?? ''}
            error={state.errors?.startsOn}
            hint="Months before this are not charged for it."
          />
          <TextField
            label="Stopped" name="endsOn" type="date"
            defaultValue={cost?.endsOn ?? ''}
            error={state.errors?.endsOn}
            hint="Leave blank while it is still being paid."
          />
        </div>
        <TextareaField
          label="Notes" name="notes" rows={2}
          defaultValue={cost?.notes ?? ''}
          hint="Optional — the supplier, the contract, whatever you would want to remember."
        />
        <Checkbox
          name="isActive"
          defaultChecked={cost ? cost.isActive : true}
          label="Still being paid"
          hint="Turning it off stops it counting from now on and leaves every past month as it was."
        />
        {state.errors?.form && (
          <p role="alert" className="text-caption text-state-danger">{state.errors.form}</p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Save label={cost ? 'Save' : 'Add'} />
        </div>
      </form>
    </Modal>
  )
}

function Save({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return <Button type="submit" loading={pending}>{label}</Button>
}
