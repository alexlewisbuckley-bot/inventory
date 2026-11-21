'use client'
import { useState } from 'react'
import { Button, ComboSelect, Modal, SelectField, TextField, useToast } from '@/components/ui'
import { commissionToSaleAction } from '@/app/actions/watches'
import { formatCurrency } from '@/lib/currency'
import { BASE_CURRENCY, CURRENCIES, SALE_CHANNELS, SALE_CHANNEL_LABELS } from '@/lib/enums'

export interface CommissionToSaleTarget {
  id: string
  label: string
  /** The commission's reference, which is usually the invoice number. */
  reference: string
  /** The fee as recorded, in base minor units — the figure on the row. */
  feeBase: number
  /** And as it was agreed, which is what the invoice actually said. */
  feeAmount: number | null
  feeCurrency: string
  /** The watch it is already against, where it is against one. */
  watchId: string | null
  stockNo: number | null
}

/*
 * A commission is all profit; a sale is a price less a cost. Going from one
 * to the other therefore needs the two figures a fee never carried, which is
 * what this asks for and nothing else.
 */
const CHANNELS = SALE_CHANNELS.filter((channel) => channel !== 'COMMISSION')

/**
 * Re-record a commission as a sale of our own watch.
 *
 * Alex: "this deal was recorded as a commission, but it actually turns out
 * that it was a purchase and sale invoice ... I'm also unable to rectify it
 * and update it and make it a purchase of a watch."
 *
 * The mirror of "Record as a commission", and it has to ask for more, because
 * a fee carries less. A sale needs a watch — a fee usually has none, since
 * the usual case is somebody else's piece — and it needs a cost, or the whole
 * invoice lands on the profit line, which is the error this exists to undo.
 *
 * The cost is left blank by default and the stock record's own figure stands.
 * Typing one here changes what the business paid for that watch everywhere,
 * so it is the owner's field, exactly as it is on the sale correction dialog.
 */
export function CommissionToSaleModal({ open, target, stock, canAmendCost = false, onClose, onDone }: {
  open: boolean
  target: CommissionToSaleTarget | null
  /** Watches still on the book, for a fee that was never linked to one. */
  stock: Array<{ id: string; label: string }>
  canAmendCost?: boolean
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [watchId, setWatchId] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<string>(BASE_CURRENCY)
  const [channel, setChannel] = useState<string>('RETAIL')
  const [cost, setCost] = useState('')
  const [costCurrency, setCostCurrency] = useState<string>(BASE_CURRENCY)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState<string | null>(null)

  if (!target) return null

  /*
   * Opened on what is already known.
   *
   * The reference is nearly always the invoice number, and the fee is nearly
   * always what the invoice said where somebody booked a sale as a fee by
   * mistake. Both are editable, because "nearly always" is not always.
   */
  if (ready !== target.id) {
    setReady(target.id)
    setWatchId(target.watchId ?? '')
    setInvoiceNo(target.reference === '—' ? '' : target.reference)
    /*
     * The agreed figure, not the converted one.
     *
     * A fee of $1,498 reads as AED 5,501.29 once it is through the rate
     * table, and opening the box on that would have somebody re-recording a
     * dollar invoice as five and a half thousand dirhams and twenty-nine
     * fils. The invoice said 1,498 dollars.
     */
    const agreed = target.feeAmount ?? target.feeBase
    setAmount(agreed ? String(agreed / 100) : '')
    setCurrency(target.feeCurrency || BASE_CURRENCY)
    setChannel('RETAIL')
    setCost('')
    setCostCurrency(BASE_CURRENCY)
  }

  async function submit() {
    const major = Number(amount)
    if (!watchId) {
      toast.error('Choose the watch', 'A sale is of a watch we owned — a fee is not.')
      return
    }
    if (!Number.isFinite(major) || major <= 0) {
      toast.error('Enter what it sold for', 'The invoice total, not the fee.')
      return
    }
    const paid = cost.trim() === '' ? null : Number(cost)
    if (paid !== null && (!Number.isFinite(paid) || paid < 0)) {
      toast.error('Check what we paid', 'Leave it blank to keep what the stock record says.')
      return
    }

    setBusy(true)
    const result = await commissionToSaleAction({
      brokerageId: target!.id,
      watchId,
      invoiceNo: invoiceNo.trim(),
      saleAmount: major,
      saleCurrency: currency,
      channel,
      purchaseAmount: paid,
      /*
       * The cost has its own currency, and does not borrow the sale's.
       * A watch bought in dirhams and sold in dollars is the ordinary case
       * here, and taking the sale's currency for both would quietly restate
       * a 40,000 dirham cost as 40,000 dollars.
       */
      purchaseCurrency: paid === null ? null : costCurrency,
    })
    setBusy(false)
    if (!result.ok) {
      toast.error('Could not convert that commission', result.message)
      return
    }
    toast.success('Recorded as a sale', result.message)
    onClose()
    onDone()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record as a sale of our watch"
      description={target.label}
      size="md"
    >
      <div className="flex flex-col gap-4">
        <p className="text-small text-content-secondary">
          For a deal booked as a fee that was really ours to buy and sell. The commission
          is voided and a sale is recorded in its place, against the watch and at the cost
          the stock record holds — so the row carries a margin instead of counting the
          whole invoice as profit. It was booked as a fee of{' '}
          <strong className="text-content-primary">{formatCurrency(target.feeBase, BASE_CURRENCY)}</strong>.
        </p>

        {target.watchId ? (
          <p className="rounded-md border border-line-subtle bg-surface-subtle px-3 py-2 text-caption text-content-secondary">
            Against{' '}
            <strong className="text-content-primary">
              {target.stockNo ? `stock ${target.stockNo}` : 'the watch it is already linked to'}
            </strong>
            , which stays sold.
          </p>
        ) : (
          <ComboSelect
            name="watchId"
            label="Which of our watches"
            placeholder="A watch from our stock"
            options={stock.map((item) => ({ value: item.id, label: item.label }))}
            value={watchId}
            onChange={setWatchId}
            emptyMessage="No stock matches. Book the watch in first, then come back."
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="invoiceNo"
            label="Invoice number"
            value={invoiceNo}
            onChange={(event) => setInvoiceNo(event.target.value)}
            autoFocus={Boolean(target.watchId)}
          />
          <SelectField
            name="channel"
            label="Kind of sale"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            options={CHANNELS.map((code) => ({ value: code, label: SALE_CHANNEL_LABELS[code] }))}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="saleAmount"
            label="What it sold for"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <SelectField
            name="saleCurrency"
            label="Currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            options={CURRENCIES.map((code) => ({ value: code, label: code }))}
          />
        </div>

        {canAmendCost && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="purchaseAmount"
              label="What we paid for it"
              type="number"
              step="0.01"
              min="0"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              hint="Leave blank to keep the cost already on the stock record. Typing one changes it there too."
            />
            <SelectField
              name="purchaseCurrency"
              label="Currency"
              value={costCurrency}
              onChange={(event) => setCostCurrency(event.target.value)}
              options={CURRENCIES.map((code) => ({ value: code, label: code }))}
            />
          </div>
        )}

        <div className="mt-1 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={() => { void submit() }} loading={busy}>
            Record as a sale
          </Button>
        </div>
      </div>
    </Modal>
  )
}
