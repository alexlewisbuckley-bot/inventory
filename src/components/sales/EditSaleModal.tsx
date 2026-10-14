'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Modal, Button, TextField, SelectField, TextareaField, MoneyField, useToast,
} from '@/components/ui'
import { amendSaleAction } from '@/app/actions/watches'
import { formatMoneyInput } from '@/lib/money'
import { toDateInput } from '@/lib/dates'
import {
  BASE_CURRENCY, DELIVERY_STATUSES, DELIVERY_STATUS_LABELS, PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS, SALE_CHANNELS, SALE_CHANNEL_LABELS,
  type CurrencyCode, type DeliveryStatus, type PaymentStatus, type SaleChannel,
} from '@/lib/enums'

export interface EditSaleTarget {
  id: string
  invoiceNo: string
  saleDate: Date
  /** As agreed, where it was recorded. Null on sales booked before the column existed. */
  saleAmount: number | null
  saleCurrency: CurrencyCode
  /** The base figure, used only as the fallback for the above. */
  amountGbp: number
  channel: SaleChannel
  paymentStatus: PaymentStatus
  deliveryStatus: DeliveryStatus
  customerName: string | null
  customerCompany: string | null
  notes: string | null
  soldById: string | null
  /** The watch's cost, as agreed, with the base figure as the fallback. */
  purchaseAmount: number | null
  purchaseCurrency: CurrencyCode
  costGbp: number | null
  stockNo: number
  label: string
}

const options = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }))

/**
 * Correct a sale that has already been booked.
 *
 * The invoice number is typed by hand with a customer in the room and then
 * goes on a piece of paper they keep. It gets mistyped, and until now the only
 * remedy was to void the sale and book it again — which throws away the row
 * the customer's invoice points at, orphans the activity on their timeline,
 * and leaves the ledger carrying two entries for one watch leaving the
 * building.
 *
 * What this does not offer is as deliberate as what it does. There is no way
 * to point the sale at a different watch or a different buyer: that is not a
 * typo, it is a different sale, and voiding is the honest way to say so. The
 * buyer's contact details are absent for a narrower reason — they belong to
 * the customer record, which is editable in the customer book, and a second
 * editable copy of a phone number is how two copies come to disagree.
 */
export function EditSaleModal({
  open, target, canAmendCost = false, salesPeople = [], onClose, onSaved,
}: {
  open: boolean
  target: EditSaleTarget | null
  /** Who may be credited with the sale. */
  salesPeople?: Array<{ id: string; name: string }>
  /**
   * Whether this reader may restate what the watch cost.
   *
   * Held apart from the rest of the dialog. `sale:update` is a Manager's, and
   * the cost is the figure the business is valued on — the stock list keeps
   * it behind `watch:amend`, which is the owner's alone, and reaching it by
   * way of the invoice screen would be the same power through a side door.
   * The field is simply absent without it, and the server refuses it too.
   */
  canAmendCost?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const router = useRouter()
  const [invoiceNo, setInvoiceNo] = useState('')
  const [saleDate, setSaleDate] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode>(BASE_CURRENCY)
  const [channel, setChannel] = useState<string>('RETAIL')
  const [paymentStatus, setPaymentStatus] = useState<string>('PAID')
  const [deliveryStatus, setDeliveryStatus] = useState<string>('COLLECTED')
  const [customerName, setCustomerName] = useState('')
  const [customerCompany, setCustomerCompany] = useState('')
  const [notes, setNotes] = useState('')
  const [soldById, setSoldById] = useState('')
  const [cost, setCost] = useState('')
  const [costCurrency, setCostCurrency] = useState<CurrencyCode>(BASE_CURRENCY)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Fill from whichever sale was opened. Keyed on the id so reopening the same
  // row after a failed save keeps what was typed, while moving to another sale
  // starts from that sale's own figures.
  const [lastId, setLastId] = useState<string | null>(null)
  if (target && target.id !== lastId) {
    setLastId(target.id)
    setInvoiceNo(target.invoiceNo)
    setSaleDate(toDateInput(target.saleDate))
    // The agreed figure in the currency it was agreed in, so a sale struck in
    // dirhams reopens in dirhams rather than as its dollar equivalent.
    const agreed = target.saleAmount ?? target.amountGbp
    setCurrency(target.saleAmount === null ? BASE_CURRENCY : target.saleCurrency)
    setAmount(formatMoneyInput(String(agreed / 100)))
    setChannel(target.channel)
    setPaymentStatus(target.paymentStatus)
    setDeliveryStatus(target.deliveryStatus)
    setCustomerName(target.customerName ?? '')
    setCustomerCompany(target.customerCompany ?? '')
    setNotes(target.notes ?? '')
    setSoldById(target.soldById ?? '')
    const paid = target.purchaseAmount ?? target.costGbp
    setCostCurrency(target.purchaseAmount === null ? BASE_CURRENCY : target.purchaseCurrency)
    setCost(paid === null ? '' : formatMoneyInput(String(paid / 100)))
    setErrors({})
  }

  if (!target) return null

  const submit = async () => {
    setBusy(true)
    setErrors({})
    const result = await amendSaleAction({
      id: target.id,
      invoiceNo,
      saleDate,
      saleAmount: amount,
      saleCurrency: currency,
      channel,
      paymentStatus,
      deliveryStatus,
      customerName,
      customerCompany,
      notes,
      soldById,
      // Left out entirely when this reader may not change it, so the dialog
      // cannot send back a figure it never showed them.
      ...(canAmendCost ? { purchaseAmount: cost, purchaseCurrency: costCurrency } : {}),
    })
    setBusy(false)
    if (result.ok) {
      toast.success('Sale corrected', `Invoice ${invoiceNo.trim()} updated.`)
      onClose()
      onSaved()
      router.refresh()
    } else {
      setErrors(result.errors ?? {})
      // A field-level message is already beside the field that caused it, so
      // the toast would be saying the same thing twice in two places.
      if (!result.errors) toast.error('Could not correct the sale', result.message)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Correct this sale"
      description={`Stock ${target.stockNo} · ${target.label}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!invoiceNo.trim() || !amount}>
            Save the correction
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Invoice number"
          required
          autoFocus
          value={invoiceNo}
          onChange={(event) => setInvoiceNo(event.target.value)}
          error={errors.invoiceNo}
          placeholder="INV-2026-001"
        />
        <TextField
          label="Sale date"
          type="date"
          required
          value={saleDate}
          onChange={(event) => setSaleDate(event.target.value)}
          error={errors.saleDate}
        />
        {canAmendCost && (
          <MoneyField
            label="Cost"
            amount={cost}
            currency={costCurrency}
            onAmountChange={setCost}
            onCurrencyChange={setCostCurrency}
            error={errors.purchaseAmount}
          />
        )}
        <div className={canAmendCost ? undefined : 'sm:col-span-2'}>
          <MoneyField
            label="Sale price"
            amount={amount}
            currency={currency}
            onAmountChange={setAmount}
            onCurrencyChange={setCurrency}
            error={errors.saleAmount}
            required
          />
        </div>
        <SelectField
          label="Channel"
          options={options(SALE_CHANNELS, SALE_CHANNEL_LABELS)}
          value={channel}
          onChange={(event) => setChannel(event.target.value)}
          error={errors.channel}
        />
        <SelectField
          label="Payment"
          options={options(PAYMENT_STATUSES, PAYMENT_STATUS_LABELS)}
          value={paymentStatus}
          onChange={(event) => setPaymentStatus(event.target.value)}
          error={errors.paymentStatus}
        />
        <SelectField
          label="Delivery"
          options={options(DELIVERY_STATUSES, DELIVERY_STATUS_LABELS)}
          value={deliveryStatus}
          onChange={(event) => setDeliveryStatus(event.target.value)}
          error={errors.deliveryStatus}
        />
        <SelectField
          label="Sold by"
          value={soldById}
          onChange={(event) => setSoldById(event.target.value)}
          placeholder="Not recorded"
          options={salesPeople.map((person) => ({ value: person.id, label: person.name }))}
          error={errors.soldById}
        />
        <TextField
          label="Customer"
          value={customerName}
          onChange={(event) => setCustomerName(event.target.value)}
          error={errors.customerName}
          hint="The name on the ledger. Their record lives in the customer book."
        />
        <TextField
          label="Company"
          className="sm:col-span-2"
          value={customerCompany}
          onChange={(event) => setCustomerCompany(event.target.value)}
          error={errors.customerCompany}
        />
        <TextareaField
          label="Notes"
          className="sm:col-span-2"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          error={errors.notes}
        />
      </div>

      <p className="mt-4 text-caption text-content-secondary">
        Profit and margin are worked out again from the cost, and the rates the watch was
        bought and sold at are kept. Changing the cost changes it on the stock record too —
        it is one figure, not a copy. The correction is written to the watch&rsquo;s history
        with the old and new values, so what the invoice used to say stays answerable. To move
        this sale to a different watch or a different buyer, void it and record it again —
        that is a different sale, not a typo.
      </p>
    </Modal>
  )
}
