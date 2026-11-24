'use client'
import { useState } from 'react'
import { Button, Modal, SelectField, TextField, useToast } from '@/components/ui'
import { renewBuybackAction } from '@/app/actions/buybacks'
import { CURRENCIES } from '@/lib/enums'

export interface RenewTarget {
  id: string
  customerName: string
  /** The date it is currently agreed to be redeemed on, if any. */
  dueOn: string | null
  /** What a month costs them, for the sentence that says nothing changes. */
  monthlyBase: number
  /** How many times they have rolled on already. */
  renewals: number
}

/**
 * "He's agreed to pay the interest again for another month."
 *
 * The thing this dialog has to be clearest about is what it does *not* do.
 *
 * Interest on a buy-back is not typed in and never was: every month a loan
 * stays open earns its charge, raised automatically. So this does not bill
 * anything, and pressing it twice does not charge twice. What it records is
 * the agreement — that the customer has said they will take another month —
 * which until now had nowhere to live, leaving a loan running past the date
 * it was due to be redeemed with nothing on the screen acknowledging it.
 *
 * The fee is blank and ought to stay blank most of the time. It is for a
 * charge made *for extending*, over and above the month's interest, which is
 * a separate thing agreed in the same conversation.
 */
export function RenewBuybackModal({ target, onClose, onDone }: {
  target: RenewTarget
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [months, setMonths] = useState('1')
  const [agreedOn, setAgreedOn] = useState(new Date().toISOString().slice(0, 10))
  const [feeAmount, setFeeAmount] = useState('')
  const [feeCurrency, setFeeCurrency] = useState('AED')
  const [note, setNote] = useState('')

  const submit = async () => {
    setBusy(true)
    try {
      const result = await renewBuybackAction({
        buybackId: target.id,
        months: Number(months) || 1,
        agreedOn: agreedOn || null,
        feeAmount: feeAmount.trim() ? Math.round(Number(feeAmount) * 100) : null,
        feeCurrency,
        note: note.trim() || null,
      })
      if (result.ok) {
        toast.success(result.message ?? 'Renewed.')
        onDone()
        onClose()
      } else {
        toast.error(result.message ?? 'That did not work.')
      }
    } catch {
      toast.error('That did not reach the server. Try it again.')
    } finally {
      setBusy(false)
    }
  }

  const count = Number(months) || 1

  return (
    <Modal
      open
      onClose={onClose}
      title={`${target.customerName} is taking another month`}
      description="Records the agreement and moves the redemption date. It does not charge anything: the monthly interest is raised on its own, as it always has been."
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={busy}>
            {busy ? 'Recording…' : `Renew for ${count} ${count === 1 ? 'month' : 'months'}`}
          </Button>
        </>
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="months"
          label="How many months"
          type="number"
          min="1"
          max="24"
          value={months}
          onChange={(event) => setMonths(event.target.value)}
          hint={target.dueOn
            ? 'Counted from the date it is already due, not from today.'
            : 'Counted from the end of the month it is currently in.'}
        />
        {/*
          When they agreed, not when somebody got round to typing it. A
          renewal agreed on the phone on Friday and entered on Monday is a
          Friday renewal, and the record should say so.
        */}
        <TextField
          name="agreedOn"
          label="Agreed on"
          type="date"
          value={agreedOn}
          onChange={(event) => setAgreedOn(event.target.value)}
        />

        <div className="sm:col-span-2 rounded-md border border-line-subtle bg-surface-subtle px-4 py-3">
          <p className="text-caption text-content-secondary">
            Their interest carries on being charged every month either way — this does not add
            a month&rsquo;s interest and pressing it twice will not charge them twice.
            {target.renewals > 0 && ` They have rolled on ${target.renewals} ${target.renewals === 1 ? 'time' : 'times'} already.`}
          </p>
        </div>

        {/*
          Last, and empty. Most renewals are simply another month at the
          same rate; a fee for extending is a separate charge that somebody
          has actually agreed, and a prefilled figure is a fee charged by
          accident.
        */}
        <TextField
          name="feeAmount"
          label="Extension fee (optional)"
          placeholder="Leave blank unless you charged one"
          value={feeAmount}
          onChange={(event) => setFeeAmount(event.target.value)}
        />
        <SelectField
          name="feeCurrency"
          label="Fee currency"
          value={feeCurrency}
          onChange={(event) => setFeeCurrency(event.target.value)}
          options={CURRENCIES.map((code) => ({ value: code, label: code }))}
        />

        <div className="sm:col-span-2">
          <TextField
            name="note"
            label="Note (optional)"
            placeholder="What was agreed, in their words"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      </div>
    </Modal>
  )
}
