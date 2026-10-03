'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import {
  Modal, Button, TextField, MoneyField, ComboSelect, useToast, useCurrency,
} from '@/components/ui'
import { holdOrDepositAction } from '@/app/actions/watches'
import { quickCreateCustomerAction } from '@/app/actions/crm'
import { formatMoneyInput, parseMoneyInput } from '@/lib/money'
import { fromBase, toBase } from '@/lib/currency'
import { toDateInput } from '@/lib/dates'
import type { CurrencyCode } from '@/lib/enums'
import type { SellCustomerOption } from './QuickSellModal'

export interface HoldTarget {
  id: string
  stockNo: number
  model: string
  brandName: string
  estSaleGbp: number | null
}

/**
 * Who is it for, and what have they paid.
 *
 * Putting a watch on hold used to be a status and nothing else: the row said
 * "reserved" and nothing anywhere said who for, what was agreed, what had
 * been paid or who took the call. A week later the only way to find out was
 * to ask whoever was on that day.
 *
 * So the status is not a status on its own any more. Choosing hold or deposit
 * opens this, and the deal is written with it — one event, not an inventory
 * edit and a CRM errand somebody might get round to. A watch that already has
 * an open deal keeps it: moving from hold to deposit is one negotiation
 * progressing, not a second one starting.
 */
export function HoldModal({ open, watch, status, customers = [], onClose, onDone }: {
  open: boolean
  watch: HoldTarget | null
  /** Which of the two this is. Decides whether a deposit is asked for. */
  status: 'RESERVED' | 'SALE_AGREED'
  customers?: SellCustomerOption[]
  onClose: () => void
  onDone: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const { currency: display, rates, money } = useCurrency()
  const [customerId, setCustomerId] = useState('')
  const [agreed, setAgreed] = useState('')
  const [deposit, setDeposit] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode>(display)
  const [until, setUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const taking = status === 'SALE_AGREED'

  // Reset when a different watch is opened. The asking price is stored in the
  // base currency, so it is converted into whatever the field is showing.
  const [lastKey, setLastKey] = useState<string | null>(null)
  const key = watch ? `${watch.id}:${status}` : null
  if (key && key !== lastKey) {
    setLastKey(key)
    setCurrency(display)
    setAgreed(watch!.estSaleGbp !== null
      ? formatMoneyInput(String(fromBase(watch!.estSaleGbp, display, rates) / 100))
      : '')
    setDeposit('')
    setCustomerId('')
    setUntil('')
    setNotes('')
    setErrors({})
  }

  /** A typed amount in the base currency, or nothing if the box is empty. */
  const asBase = (raw: string) => {
    const minor = parseMoneyInput(raw)
    return minor === null ? null : toBase(minor, currency, rates)
  }
  const agreedBase = asBase(agreed)
  const depositBase = asBase(deposit)
  const balance = agreedBase !== null && depositBase !== null ? agreedBase - depositBase : null

  const submit = async () => {
    const next: Record<string, string> = {}
    if (!customerId) next.customerId = 'Choose who it is for.'
    if (taking && !depositBase) next.deposit = 'Enter what they have paid.'
    if (balance !== null && balance < 0) next.deposit = 'That is more than the agreed price.'
    setErrors(next)
    if (Object.keys(next).length) return

    setBusy(true)
    const result = await holdOrDepositAction({
      watchId: watch!.id,
      status,
      customerId,
      valueGbp: agreedBase,
      depositGbp: depositBase,
      expectedClose: until || null,
      notes: notes.trim() || null,
    })
    setBusy(false)
    if (!result.ok) { toast.error('Could not record that', result.message); return }
    toast.success(result.message ?? 'Done', 'The deal is on the board.')
    onDone()
    onClose()
    router.refresh()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={taking ? 'Take a deposit' : 'Put on hold'}
      description={watch
        ? `Stock ${watch.stockNo} · ${watch.brandName} ${watch.model}`
        : undefined}
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy}>
            {taking ? 'Record the deposit' : 'Put on hold'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <ComboSelect
          name="customerId"
          label="Who is it for"
          required
          error={errors.customerId}
          value={customerId}
          onChange={setCustomerId}
          placeholder="Search the customer book…"
          options={customers.map((c) => ({
            value: c.id,
            label: [c.name, c.company].filter(Boolean).join(' · '),
          }))}
          createLabel="Add"
          onCreate={async (name) => {
            const result = await quickCreateCustomerAction(name)
            if (!result.ok || !result.id) {
              toast.error('Could not add them', result.message)
              return null
            }
            // Just a name here on purpose. The rest of the record is asked for
            // when there is a reason to ask; a hold taken over the phone
            // should not stop for a VAT number.
            toast.success(`${result.label} added`, 'Fill in the rest of their record when you have it.')
            return { value: result.id, label: result.label! }
          }}
          emptyMessage={<>No one by that name — type it and press <strong>Add</strong>.</>}
          hint={<span className="inline-flex items-center gap-1"><UserPlus className="h-3 w-3" aria-hidden /> Name only to start with.</span>}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            label="Agreed price"
            amountName="agreed"
            amount={agreed}
            onAmountChange={setAgreed}
            currency={currency}
            onCurrencyChange={setCurrency}
            hint="Starts at the asking price."
          />
          {taking && (
            <MoneyField
              label="Deposit taken"
              amountName="deposit"
              required
              error={errors.deposit}
              amount={deposit}
              onAmountChange={setDeposit}
              currency={currency}
              onCurrencyChange={setCurrency}
            />
          )}
        </div>

        {/* The figure somebody actually asks for at the counter. */}
        {taking && balance !== null && (
          <div className="flex items-center justify-between rounded-sm border border-line-subtle bg-surface-subtle px-4 py-3">
            <span className="text-small text-content-secondary">Balance outstanding</span>
            <span className="text-h3 font-extrabold tabular-nums text-content-primary">
              {money(balance)}
            </span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="until"
            label={taking ? 'Expected completion' : 'Held until'}
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            min={toDateInput(new Date())}
            hint={taking ? undefined : 'A hold with no end date is stock off the market indefinitely.'}
          />
          <TextField
            name="notes"
            label="Note"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the next person needs to know"
          />
        </div>

        <p className="text-caption text-content-secondary">
          This opens a deal against the watch in your name, or updates the one already open.
          It will be on the <Link href="/deals" className="font-semibold text-content-accent hover:underline">deals board</Link>.
        </p>
      </div>
    </Modal>
  )
}
