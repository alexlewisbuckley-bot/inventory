'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState, useFormStatus } from 'react-dom'
import { Pencil, Plus } from 'lucide-react'
import {
  Button, ComboSelect, Drawer, SelectField, TextField, useToast,
} from '@/components/ui'
import { useCreateFlag } from '@/components/ui/CreateAction'
import { quickCreateCustomerAction, saveDealAction } from '@/app/actions/crm'
import { DEAL_STAGES, DEAL_STAGE_LABELS, LEAD_SOURCES, LEAD_SOURCE_LABELS } from '@/lib/enums'
import { toMajor } from '@/lib/money'
import type { ActionState } from '@/app/actions/auth'

const INITIAL: ActionState = { ok: false }

/**
 * Opening a deal.
 *
 * Picking the watch pre-fills the value from its asking price, because that is
 * the number the deal starts at nine times in ten and retyping it is exactly
 * the kind of friction that leaves a pipeline half-populated.
 */
export function DealFormPanel({
  customers, stock, owners, presetCustomerId, presetWatchId,
  triggerLabel = 'New deal', variant = 'primary', size = 'md', deal,
}: {
  customers: Array<{ id: string; name: string }>
  stock: Array<{
    id: string; stockNo: number; label: string; serial: string | null; estSaleGbp: number | null
  }>
  owners: Array<{ id: string; name: string }>
  presetCustomerId?: string
  presetWatchId?: string
  triggerLabel?: string
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  /**
   * Supplied to edit rather than create.
   *
   * The action already branches on `id` and `updateDeal` has always existed;
   * what was missing was any way for a person to reach it. The deal record is
   * where that gap became obvious — a screen that shows four editable facts
   * and cannot edit them.
   */
  deal?: {
    id: string
    title: string
    customerId: string | null
    watchId: string | null
    valueGbp: number | null
    stage: string
    expectedClose: string | null
    ownerId: string | null
    source: string
    notes: string | null
  }
}) {
  const router = useRouter()
  const toast = useToast()
  const create = useCreateFlag()
  // Editing keeps its state locally rather than in `?new=1`. The URL flag is
  // what makes "add a deal" deep-linkable, and it is shared by every panel on
  // a page — so an edit drawer driven by it would open alongside whatever else
  // on that page listens for the same flag.
  const [editing, setEditing] = useState(false)
  const open = deal ? editing : create.open
  const dismiss = () => (deal ? setEditing(false) : create.close())
  const [state, action] = useFormState(saveDealAction, INITIAL)

  const [customerId, setCustomerId] = useState(deal?.customerId ?? presetCustomerId ?? '')
  const [watchId, setWatchId] = useState(deal?.watchId ?? presetWatchId ?? '')
  const [value, setValue] = useState(deal?.valueGbp ? String(toMajor(deal.valueGbp)) : '')

  const chooseWatch = (id: string) => {
    setWatchId(id)
    const watch = stock.find((item) => item.id === id)
    if (watch?.estSaleGbp) setValue(String(toMajor(watch.estSaleGbp)))
  }

  useEffect(() => {
    if (!state.ok) return
    dismiss()
    toast.success(state.message ?? 'Saved')
    router.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <>
      <Button
        variant={variant}
        size={size}
        // A plus on an edit button is a small lie about what it does.
        icon={deal ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        onClick={() => (deal ? setEditing(true) : create.openIt())}
      >
        {triggerLabel}
      </Button>

      <Drawer
        open={open}
        onClose={dismiss}
        title={deal ? 'Edit this deal' : 'Open a deal'}
        subtitle={deal
          ? 'Changing the value here changes the margin shown against the watch.'
          : 'A deal is a sale before it is a sale. Winning one hands over to the ledger.'}
      >
        <form action={action} className="flex flex-col gap-5">
          {deal && <input type="hidden" name="id" value={deal.id} />}
          <TextField
            name="title"
            label="What is it"
            required
            autoFocus
            defaultValue={deal?.title}
            placeholder="Daytona 126500LN for Mr Al Mansoori"
            hint="Something you would recognise on a board of twenty."
            error={state.errors?.title}
          />

          {/* Creating in place. Being sent to another screen to add somebody
              who is not on the book means losing everything typed so far,
              which is how a pipeline ends up half-populated. */}
          <ComboSelect
            name="customerId"
            label="Customer"
            value={customerId}
            onChange={setCustomerId}
            placeholder={customers.length === 0 ? 'Nobody on the book yet — type a name' : 'Choose a customer…'}
            createLabel="Add"
            hint="Not on the book? Type their name and add them here."
            onCreate={async (name) => {
              const result = await quickCreateCustomerAction(name)
              if (!result.ok || !result.id) {
                toast.error('Could not add the customer', result.message)
                return null
              }
              toast.success(`${result.label} added`, 'Fill in the rest on their record when you have a moment.')
              return { value: result.id, label: result.label ?? name }
            }}
            options={customers.map((customer) => ({ value: customer.id, label: customer.name }))}
          />
          <ComboSelect
            name="watchId"
            label="Watch"
            value={watchId}
            onChange={chooseWatch}
            placeholder="Not against a specific watch yet"
            emptyMessage="No stock matches that. A deal does not need a watch — leave it blank while you source one."

            options={stock.map((item) => ({
              value: item.id,
              // Stock number, reference, then serial: the first identifies the
              // row, the second is what people say out loud, and the third is
              // the only thing that separates two of the same model.
              label: [`${item.stockNo} · ${item.label}`, item.serial].filter(Boolean).join(' · '),
            }))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="valueGbp"
              label="Value"
              prefix="£"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              hint="Pre-filled from the asking price when you pick a watch."
            />
            <SelectField
              name="stage"
              label="Stage"
              defaultValue={deal?.stage ?? 'ENQUIRY'}
              options={DEAL_STAGES.map((stage) => ({ value: stage, label: DEAL_STAGE_LABELS[stage] }))}
            />
            <TextField
              name="expectedClose" type="date" label="Expected to close"
              defaultValue={deal?.expectedClose ?? undefined}
            />
            <SelectField
              name="ownerId"
              label="Owner"
              placeholder="You"
              defaultValue={deal?.ownerId ?? undefined}
              options={owners.map((owner) => ({ value: owner.id, label: owner.name }))}
            />
            <SelectField
              name="source"
              label="Where it came from"
              defaultValue={deal?.source ?? 'UNKNOWN'}
              className="sm:col-span-2"
              options={LEAD_SOURCES.map((source) => ({ value: source, label: LEAD_SOURCE_LABELS[source] }))}
            />
          </div>

          <div>
            <label htmlFor="deal-notes" className="text-caption font-semibold text-content-secondary">Notes</label>
            <textarea
              id="deal-notes"
              name="notes"
              rows={3}
              defaultValue={deal?.notes ?? undefined}
              placeholder="What they want, what they have said, what happens next."
              className="mt-1.5 w-full rounded-md border border-line-subtle bg-surface-raised px-3.5 py-3 text-body text-content-primary placeholder:text-content-muted"
            />
          </div>

          {state.message && !state.ok && (
            <p role="alert" className="text-small text-state-danger">{state.message}</p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-line-subtle pt-4">
            <Button variant="ghost" type="button" onClick={dismiss}>Cancel</Button>
            <SaveButton label={deal ? 'Save changes' : 'Open the deal'} />
          </div>
        </form>
      </Drawer>
    </>
  )
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return <Button type="submit" loading={pending}>{label}</Button>
}
