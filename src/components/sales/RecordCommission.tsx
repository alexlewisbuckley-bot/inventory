'use client'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button, Modal, SelectField, TextField, TextareaField, useToast } from '@/components/ui'
import { recordBrokerageAction } from '@/app/actions/watches'
import { BASE_CURRENCY, CURRENCIES, PAYMENT_STATUSES } from '@/lib/enums'

/**
 * Record a fee earned selling somebody else's watch.
 *
 * A button beside Export rather than a section of its own: the rows land
 * in the sales ledger with everything else, so this is just the way in.
 */
export function RecordCommission({ people }: { people: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Record a commission
      </Button>
      <RecordModal open={open} onClose={() => setOpen(false)} people={people} />
    </>
  )
}

function RecordModal({ open, onClose, people }: {
  open: boolean
  onClose: () => void
  people: Array<{ id: string; name: string }>
}) {
  const toast = useToast()
  const router = useRouter()
  const [state, action] = useFormState(recordBrokerageAction, { ok: false })

  /*
   * In an effect, not in the render.
   *
   * Closing the panel and refreshing from the render body is a state update
   * during another component's render: React refuses it, and the panel sat
   * open looking as though the button had done nothing.
   */
  useEffect(() => {
    if (!state.ok || !open) return
    // The action's own sentence is the title; repeating it as the
    // description said the same thing twice.
    toast.success('Commission recorded', 'It is in the sales ledger.')
    onClose()
    router.refresh()
    // `state` is the identity that changes on a successful submit; the
    // callbacks are stable enough that re-running on them would only close
    // the panel somebody has just reopened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const today = new Date().toISOString().slice(0, 10)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a commission"
      description="A watch sold for somebody else. There is no stock behind it, so no cost and no margin — the fee is the whole of it."
      size="md"
    >
      <form action={action} className="flex flex-col gap-4">
        {state.message && !state.ok && (
          <p role="alert" className="rounded-md border border-state-danger/30 bg-state-danger/8 px-4 py-3 text-small text-state-danger">
            {state.message}
          </p>
        )}

        <TextField
          name="description"
          label="What was sold"
          placeholder="Rolex Daytona 116500LN"
          required
          error={state.errors?.description}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="feeAmount" label="Commission" type="number" step="0.01" min="0" required
            placeholder="5000" error={state.errors?.feeAmount} />
          <SelectField name="feeCurrency" label="Currency" defaultValue={BASE_CURRENCY}
            options={CURRENCIES.map((code) => ({ value: code, label: code }))} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="brokeredOn" label="Date" type="date" defaultValue={today} required
            error={state.errors?.brokeredOn} />
          <SelectField name="paymentStatus" label="Payment" defaultValue="PAID"
            options={PAYMENT_STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="soldFor" label="Sold for (optional)" placeholder="Whose watch it was" />
          <TextField name="soldTo" label="Sold to (optional)" placeholder="Who bought it" />
        </div>

        <SelectField
          name="soldById"
          label="Who brokered it"
          defaultValue=""
          options={[{ value: '', label: 'Not recorded' },
            ...people.map((person) => ({ value: person.id, label: person.name }))]}
          hint="Counts towards their commission and target, the same as a sale."
        />

        <TextareaField name="notes" label="Notes (optional)" rows={2} />

        <div className="mt-2 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Submit />
        </div>
      </form>
    </Modal>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return <Button type="submit" loading={pending}>{pending ? 'Recording…' : 'Record commission'}</Button>
}
