'use client'
import { useMemo, useState } from 'react'
import {
  Modal, Button, TextField, SelectField, MoneyField, ComboSelect, Chip, useToast, useCurrency,
} from '@/components/ui'
import { recordSaleAction } from '@/app/actions/watches'
import { formatMoneyInput, formatPct, parseMoneyInput } from '@/lib/money'
import { fromBase, toBase } from '@/lib/currency'
import { toDateInput } from '@/lib/dates'
import {
  DELIVERY_STATUSES, DELIVERY_STATUS_LABELS, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS,
  SALE_CHANNELS, SALE_CHANNEL_LABELS, type CurrencyCode,
} from '@/lib/enums'

export interface QuickSellTarget {
  id: string
  stockNo: number
  model: string
  brandName: string
  purchasePriceGbp: number
  estSaleGbp: number | null
}

export interface SellCustomerOption {
  id: string
  name: string
  company: string | null
  email: string | null
  phone: string | null
  country: string | null
}

export interface SellDealOption {
  id: string
  title: string
  stage: string
  valueGbp: number | null
  customerId: string | null
}

/**
 * Fast path for "this one sold".
 *
 * Four fields and a live profit figure, reachable directly from a row without
 * opening the record first. Defaults the sale price to the estimate and the
 * date to today, so the common case is two keystrokes and Enter.
 */
export function QuickSellModal({ open, watch, customers = [], deals = [], onClose, onSold }: {
  open: boolean
  watch: QuickSellTarget | null
  customers?: SellCustomerOption[]
  deals?: SellDealOption[]
  onClose: () => void
  onSold: () => void
}) {
  const toast = useToast()
  const { currency: display, rates, money, signed } = useCurrency()
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode>(display)
  const [invoiceNo, setInvoiceNo] = useState('')
  const [saleDate, setSaleDate] = useState(toDateInput(new Date()))
  const [channel, setChannel] = useState('RETAIL')
  const [customerName, setCustomerName] = useState('')
  const [customerCompany, setCustomerCompany] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [dealId, setDealId] = useState('')
  const [newBuyer, setNewBuyer] = useState(false)
  const [paymentStatus, setPaymentStatus] = useState('PAID')
  const [deliveryStatus, setDeliveryStatus] = useState('COLLECTED')
  const [deposit, setDeposit] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Reset when a different watch is opened. The estimate is stored in GBP, so
  // it is converted into whichever currency the field is currently showing.
  const [lastId, setLastId] = useState<string | null>(null)
  if (watch && watch.id !== lastId) {
    setLastId(watch.id)
    setCurrency(display)
    // Grouped like anything the user types into it, rather than arriving as
    // a bare 8284.14 beside fields that all format themselves.
    setAmount(watch.estSaleGbp !== null
      ? formatMoneyInput(String(fromBase(watch.estSaleGbp, display, rates) / 100))
      : '')
    setInvoiceNo('')
    setSaleDate(toDateInput(new Date()))
    setCustomerName('')
    setCustomerCompany('')
    setCustomerEmail('')
    setCustomerPhone('')
    setNewBuyer(false)
    setPaymentStatus('PAID')
    setDeliveryStatus('COLLECTED')
    setDeposit('')
    // A deal already open against this watch is almost certainly the sale
    // being recorded, so it is pre-selected along with its customer.
    const candidate = deals.find((deal) => deal.customerId) ?? deals[0]
    setDealId(candidate?.id ?? '')
    setCustomerId(candidate?.customerId ?? '')
    setErrors({})
  }

  /** Picking a customer fills the buyer details from the record. */
  const chooseCustomer = (id: string) => {
    setCustomerId(id)
    setNewBuyer(false)
    const customer = customers.find((c) => c.id === id)
    if (!customer) return
    setCustomerName(customer.name)
    setCustomerCompany(customer.company ?? '')
    setCustomerEmail(customer.email ?? '')
    setCustomerPhone(customer.phone ?? '')
  }

  const projection = useMemo(() => {
    if (!watch) return null
    const entered = parseMoneyInput(amount)
    if (entered === null || watch.purchasePriceGbp === 0) return null
    // Compare like with like: convert to the GBP base before taking a margin.
    const saleGbp = toBase(entered, currency, rates)
    const profit = saleGbp - watch.purchasePriceGbp
    return { profit, margin: (profit / watch.purchasePriceGbp) * 100 }
  }, [amount, currency, rates, watch])

  if (!watch) return null

  const submit = async () => {
    setBusy(true)
    setErrors({})
    const data = new FormData()
    const minor = parseMoneyInput(amount)
    data.set('watchId', watch.id)
    data.set('invoiceNo', invoiceNo)
    data.set('saleDate', saleDate)
    data.set('saleAmount', minor !== null ? String(minor / 100) : '')
    data.set('saleCurrency', currency)
    data.set('channel', channel)
    data.set('customerName', customerName)
    data.set('customerCompany', customerCompany)
    data.set('customerEmail', customerEmail)
    data.set('customerPhone', customerPhone)
    data.set('customerId', customerId)
    data.set('dealId', dealId)
    data.set('paymentStatus', paymentStatus)
    data.set('deliveryStatus', deliveryStatus)
    data.set('depositGbp', deposit ? deposit.replace(/[^0-9.]/g, '') : '')
    const result = await recordSaleAction({ ok: false }, data)
    setBusy(false)
    if (result.ok) {
      toast.success('Sale recorded', `Stock ${watch.stockNo} moved to Sold.`)
      onClose()
      onSold()
    } else {
      setErrors(result.errors ?? {})
      if (result.message) toast.error('Could not record the sale', result.message)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mark as sold"
      description={`Stock ${watch.stockNo} · ${watch.brandName} ${watch.model}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!amount || !invoiceNo}>Record the sale</Button>
        </>
      }
    >
      <div className="mb-4 flex items-center justify-between gap-4 rounded-md bg-surface-subtle px-4 py-3">
        <span className="text-small text-content-secondary">Bought for</span>
        <span className="text-small font-bold tabular-nums text-content-primary">
          {money(watch.purchasePriceGbp)}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField
          label="Sale amount"
          required
          autoFocus
          amount={amount}
          currency={currency}
          onAmountChange={setAmount}
          onCurrencyChange={setCurrency}
          hint={watch.estSaleGbp !== null ? 'Pre-filled from the estimate.' : undefined}
          error={errors.saleAmount}
        />
        <TextField
          label="Invoice number" required
          value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)}
          placeholder="INV-2026-001" error={errors.invoiceNo}
        />
        <TextField
          label="Sale date" type="date" required
          value={saleDate} onChange={(e) => setSaleDate(e.target.value)}
          error={errors.saleDate}
        />
        <SelectField
          label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}
          hint={channel === 'TRADE' ? 'Sold to another dealer.' : channel === 'RETAIL' ? 'Sold to an end customer.' : undefined}
          options={SALE_CHANNELS.map((c) => ({ value: c, label: SALE_CHANNEL_LABELS[c] }))}
        />
      </div>

      {/* Who bought it.
          The buyer is a customer record wherever possible, so the sale lands on
          their timeline and their lifetime value. Typing the name into a box
          instead — which is all this form used to allow — is how a customer
          book and a sales ledger end up describing different people. */}
      <fieldset className="mt-5 border-t border-line-subtle pt-4">
        {/* One heading, not a visible label beside a screen-reader-only one
            saying the same word twice. */}
        <legend className="mb-3 text-caption font-semibold text-content-secondary">
          Buyer{channel === 'TRADE' ? ' — the dealer you sold to' : ''}
        </legend>

        <ComboSelect
          name="customerPicker"
          label="Customer"
          value={customerId}
          onChange={chooseCustomer}
          placeholder={customers.length === 0 ? 'No customers on file yet' : 'Search the customer book…'}
          options={customers.map((customer) => ({
            value: customer.id,
            label: customer.company ? `${customer.name} · ${customer.company}` : customer.name,
          }))}
          hint="Linking the sale puts it on their record and their lifetime value."
        />

        <div className="mt-2 flex flex-wrap items-center gap-3">
          {customerId ? (
            <button
              type="button"
              onClick={() => {
                setCustomerId('')
                setCustomerName('')
                setCustomerCompany('')
                setCustomerEmail('')
                setCustomerPhone('')
              }}
              className="text-caption font-bold text-content-accent hover:underline"
            >
              Clear and enter the buyer by hand
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setNewBuyer((value) => !value)}
              className="text-caption font-bold text-content-accent hover:underline"
            >
              {newBuyer ? 'Hide the buyer fields' : 'Not on file — record their details'}
            </button>
          )}
        </div>

        {(newBuyer || (!customerId && (customerName || customerEmail))) && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <TextField
              label={channel === 'TRADE' ? 'Contact name' : 'Customer name'}
              value={customerName} onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Who took the watch"
              error={errors.customerName}
            />
            <TextField
              label={channel === 'TRADE' ? 'Dealer or company' : 'Company'}
              value={customerCompany} onChange={(e) => setCustomerCompany(e.target.value)}
              placeholder="Optional"
              error={errors.customerCompany}
            />
            <TextField
              label="Email" type="email"
              value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="Optional"
              error={errors.customerEmail}
            />
            <TextField
              label="Phone"
              value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Optional"
              error={errors.customerPhone}
            />
            <p className="text-caption text-content-secondary sm:col-span-2">
              Recorded against the sale only. Add them to the customer book from
              Customers if you expect to deal with them again.
            </p>
          </div>
        )}

        {deals.length > 0 && (
          <div className="mt-4 rounded-md border border-teal-500/40 bg-teal-100/40 px-4 py-3">
            <p className="text-caption font-semibold text-content-accent">
              {deals.length === 1 ? 'There is a deal open against this watch' : 'There are deals open against this watch'}
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {deals.map((deal) => (
                <label key={deal.id} className="flex cursor-pointer items-center gap-2.5 text-small text-content-primary">
                  <input
                    type="radio"
                    name="dealChoice"
                    checked={dealId === deal.id}
                    onChange={() => {
                      setDealId(deal.id)
                      if (deal.customerId) chooseCustomer(deal.customerId)
                    }}
                    className="h-4 w-4 accent-teal-500"
                  />
                  <span className="min-w-0 flex-1 truncate">{deal.title}</span>
                  <Chip tone="neutral">{deal.stage.replace('_', ' ').toLowerCase()}</Chip>
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-2.5 text-small text-content-secondary">
                <input
                  type="radio"
                  name="dealChoice"
                  checked={dealId === ''}
                  onChange={() => setDealId('')}
                  className="h-4 w-4 accent-teal-500"
                />
                This sale is not from any of them
              </label>
            </div>
            {dealId && (
              <p className="mt-2 text-caption text-content-accent">
                Recording the sale will mark that deal as won.
              </p>
            )}
          </div>
        )}
      </fieldset>

      {/* What is still outstanding. A sale is rarely one clean moment: money
          and the watch itself move on different days, and a ledger that cannot
          say which has happened is one somebody keeps a spreadsheet beside. */}
      <fieldset className="mt-5 border-t border-line-subtle pt-4">
        <legend className="mb-3 text-caption font-semibold text-content-secondary">
          Payment and delivery
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            label="Payment"
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value)}
            options={PAYMENT_STATUSES.map((status) => ({ value: status, label: PAYMENT_STATUS_LABELS[status] }))}
          />
          {(paymentStatus === 'DEPOSIT' || paymentStatus === 'PENDING') && (
            <TextField
              label="Deposit taken"
              prefix="£"
              inputMode="decimal"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              error={errors.depositGbp}
            />
          )}
          <SelectField
            label="The watch itself"
            value={deliveryStatus}
            onChange={(e) => setDeliveryStatus(e.target.value)}
            options={DELIVERY_STATUSES.map((status) => ({ value: status, label: DELIVERY_STATUS_LABELS[status] }))}
          />
        </div>
      </fieldset>

      <div className="mt-4 flex items-center justify-between gap-4 rounded-md bg-teal-100 px-4 py-3" aria-live="polite">
        <span className="text-caption font-semibold text-content-accent">Profit on this sale</span>
        <span className="text-h3 font-extrabold tabular-nums text-content-accent">
          {projection ? `${signed(projection.profit)} · ${formatPct(projection.margin)}` : '—'}
        </span>
      </div>
    </Modal>
  )
}
