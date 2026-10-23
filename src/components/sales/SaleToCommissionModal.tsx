'use client'
import { useState } from 'react'
import { Button, Modal, SelectField, TextField, useToast } from '@/components/ui'
import { saleToCommissionAction } from '@/app/actions/watches'
import { formatCurrency } from '@/lib/currency'
import { BASE_CURRENCY, CURRENCIES } from '@/lib/enums'

export interface CommissionTarget {
  id: string
  label: string
  invoiceNo: string
  /** What the sale was booked at, in base minor units. */
  amountGbp: number
}

/**
 * Re-record a direct sale as a commission.
 *
 * For the watch that went out for a fee and was booked as a sale, which
 * gives it a cost and a margin it never had. Asks the one thing the system
 * cannot know — what we were actually paid — and does the rest: the sale is
 * voided, the fee is recorded against the same watch, and the watch stays
 * sold, because it did sell.
 */
export function SaleToCommissionModal({ open, target, onClose, onDone }: {
  open: boolean
  target: CommissionTarget | null
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<string>(BASE_CURRENCY)
  const [busy, setBusy] = useState(false)

  if (!target) return null

  async function submit() {
    const major = Number(amount)
    if (!Number.isFinite(major) || major <= 0) {
      toast.error('Enter the commission', 'The fee we were paid, not the sale price.')
      return
    }
    setBusy(true)
    const result = await saleToCommissionAction({
      saleId: target!.id,
      feeAmount: Math.round(major * 100),
      feeCurrency: currency,
    })
    setBusy(false)
    if (!result.ok) {
      toast.error('Could not convert that sale', result.message)
      return
    }
    toast.success('Recorded as a commission', result.message)
    setAmount('')
    onClose()
    onDone()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record as a commission"
      description={`${target.label} · invoice ${target.invoiceNo}`}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-small text-content-secondary">
          The sale will be voided and a commission recorded against the same watch.
          The watch stays sold — only what we earned on it changes. It was booked at{' '}
          <strong className="text-content-primary">{formatCurrency(target.amountGbp, BASE_CURRENCY)}</strong>.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="feeAmount"
            label="Commission we were paid"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            autoFocus
          />
          <SelectField
            name="feeCurrency"
            label="Currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            options={CURRENCIES.map((code) => ({ value: code, label: code }))}
          />
        </div>

        <div className="mt-1 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={() => { void submit() }} loading={busy}>
            Record as commission
          </Button>
        </div>
      </div>
    </Modal>
  )
}
