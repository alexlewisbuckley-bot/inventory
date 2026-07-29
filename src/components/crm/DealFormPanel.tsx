'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState, useFormStatus } from 'react-dom'
import { Plus } from 'lucide-react'
import {
  Button, ComboSelect, Drawer, SelectField, TextField, useToast,
} from '@/components/ui'
import { useCreateFlag } from '@/components/ui/CreateAction'
import { saveDealAction } from '@/app/actions/crm'
import { DEAL_STAGE_LABELS, LEAD_SOURCES, LEAD_SOURCE_LABELS, OPEN_DEAL_STAGES } from '@/lib/enums'
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
export function DealFormPanel({ customers, stock, owners, presetCustomerId, presetWatchId, triggerLabel = 'New deal' }: {
  customers: Array<{ id: string; name: string }>
  stock: Array<{ id: string; stockNo: number; label: string; estSaleGbp: number | null }>
  owners: Array<{ id: string; name: string }>
  presetCustomerId?: string
  presetWatchId?: string
  triggerLabel?: string
}) {
  const router = useRouter()
  const toast = useToast()
  const create = useCreateFlag()
  const [state, action] = useFormState(saveDealAction, INITIAL)

  const [customerId, setCustomerId] = useState(presetCustomerId ?? '')
  const [watchId, setWatchId] = useState(presetWatchId ?? '')
  const [value, setValue] = useState('')

  const chooseWatch = (id: string) => {
    setWatchId(id)
    const watch = stock.find((item) => item.id === id)
    if (watch?.estSaleGbp) setValue(String(toMajor(watch.estSaleGbp)))
  }

  useEffect(() => {
    if (!state.ok) return
    create.close()
    toast.success(state.message ?? 'Saved')
    router.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <>
      <Button icon={<Plus className="h-4 w-4" />} onClick={() => create.openIt()}>{triggerLabel}</Button>

      <Drawer
        open={create.open}
        onClose={create.close}
        title="Open a deal"
        subtitle="A deal is a sale before it is a sale. Winning one hands over to the ledger."
      >
        <form action={action} className="flex flex-col gap-5">
          <TextField
            name="title"
            label="What is it"
            required
            autoFocus
            placeholder="Daytona 126500LN for Mr Al Mansoori"
            hint="Something you would recognise on a board of twenty."
            error={state.errors?.title}
          />

          <ComboSelect
            name="customerId"
            label="Customer"
            value={customerId}
            onChange={setCustomerId}
            placeholder="Choose a customer…"
            options={customers.map((customer) => ({ value: customer.id, label: customer.name }))}
          />
          <ComboSelect
            name="watchId"
            label="Watch"
            value={watchId}
            onChange={chooseWatch}
            placeholder="Not against a specific watch yet"
            options={stock.map((item) => ({
              value: item.id,
              label: `${item.stockNo} · ${item.label}`,
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
              defaultValue="ENQUIRY"
              options={OPEN_DEAL_STAGES.map((stage) => ({ value: stage, label: DEAL_STAGE_LABELS[stage] }))}
            />
            <TextField name="expectedClose" type="date" label="Expected to close" />
            <SelectField
              name="ownerId"
              label="Owner"
              placeholder="You"
              options={owners.map((owner) => ({ value: owner.id, label: owner.name }))}
            />
            <SelectField
              name="source"
              label="Where it came from"
              defaultValue="UNKNOWN"
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
              placeholder="What they want, what they have said, what happens next."
              className="mt-1.5 w-full rounded-md border border-line-subtle bg-surface-raised px-3.5 py-3 text-body text-content-primary placeholder:text-content-secondary"
            />
          </div>

          {state.message && !state.ok && (
            <p role="alert" className="text-small text-state-danger">{state.message}</p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-line-subtle pt-4">
            <Button variant="ghost" type="button" onClick={create.close}>Cancel</Button>
            <SaveButton />
          </div>
        </form>
      </Drawer>
    </>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()
  return <Button type="submit" loading={pending}>Open the deal</Button>
}
