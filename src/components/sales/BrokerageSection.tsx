'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Handshake, Plus } from 'lucide-react'
import {
  Button, Card, CardBody, CardHeader, Modal, SelectField, TextField, TextareaField, EmptyState, useToast,
} from '@/components/ui'
import { recordBrokerageAction } from '@/app/actions/watches'
import { formatCurrency } from '@/lib/currency'
import { formatDate } from '@/lib/dates'
import { BASE_CURRENCY, CURRENCIES, PAYMENT_STATUSES } from '@/lib/enums'
import type { BrokerageRow } from '@/server/services/brokerage-service'

/**
 * Fees earned selling other people's watches.
 *
 * Kept beside the sales ledger rather than in it. A brokered deal has no
 * cost and no margin, so a row of it in the sales table would be a row with
 * two empty columns and an average sale price nobody should trust — but it
 * is money earned on the same day by the same person, and making somebody
 * look in a second place for it would be its own kind of wrong.
 */
export function BrokerageSection({ rows, total, people, canRecord }: {
  rows: BrokerageRow[]
  /** Base minor units, already summed on the server. */
  total: number
  people: Array<{ id: string; name: string }>
  canRecord: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <Card className="mt-8">
      <CardHeader
        title="Commission earned"
        description="Watches sold for other people, where the fee is the whole of what we made."
        action={
          <div className="flex items-center gap-4">
          {rows.length > 0 && (
            <span className="text-body font-extrabold text-content-primary">
              {formatCurrency(total, BASE_CURRENCY)}
            </span>
          )}
          {canRecord && (
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
              Record a commission
            </Button>
          )}
          </div>
        }
      />
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Handshake className="h-6 w-6" />}
            title="No commission recorded in this period"
            description="When you sell a watch for somebody else, record the fee here — it is not stock, so it never had a cost or a margin."
            action={canRecord
              ? <Button variant="secondary" onClick={() => setOpen(true)}>Record a commission</Button>
              : undefined}
          />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                <div className="min-w-0">
                  <p className="truncate text-body font-bold text-content-primary">{row.description}</p>
                  <p className="text-caption text-content-secondary">
                    {formatDate(row.brokeredOn)}
                    {row.soldFor && ` · for ${row.soldFor}`}
                    {row.soldByName && ` · ${row.soldByName}`}
                    {row.paymentStatus !== 'PAID' && ` · ${row.paymentStatus.toLowerCase()}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-body font-extrabold text-content-primary">
                    {formatCurrency(row.feeBase, BASE_CURRENCY)}
                  </p>
                  {/* The agreed figure, where it was not agreed in dirhams.
                      Somebody reconciling against the paperwork is looking
                      for the number on the paperwork. */}
                  {row.feeCurrency !== BASE_CURRENCY && (
                    <p className="text-caption text-content-secondary">
                      {formatCurrency(row.feeAmount, row.feeCurrency as typeof BASE_CURRENCY)} as agreed
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <RecordModal open={open} onClose={() => setOpen(false)} people={people} />
    </Card>
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

  if (state.ok && open) {
    toast.success('Commission recorded', state.message)
    onClose()
    router.refresh()
  }

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
