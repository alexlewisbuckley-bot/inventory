'use client'
import { useMemo, useState } from 'react'
import { Modal, Button, TextField, SelectField, MoneyField, useToast, useCurrency } from '@/components/ui'
import { recordSaleAction } from '@/app/actions/watches'
import { formatPct, parseMoneyInput } from '@/lib/money'
import { fromBase, toBase } from '@/lib/currency'
import { toDateInput } from '@/lib/dates'
import { SALE_CHANNELS, SALE_CHANNEL_LABELS, type CurrencyCode } from '@/lib/enums'

export interface QuickSellTarget {
  id: string
  stockNo: number
  model: string
  brandName: string
  purchasePriceGbp: number
  estSaleGbp: number | null
}

/**
 * Fast path for "this one sold".
 *
 * Four fields and a live profit figure, reachable directly from a row without
 * opening the record first. Defaults the sale price to the estimate and the
 * date to today, so the common case is two keystrokes and Enter.
 */
export function QuickSellModal({ open, watch, onClose, onSold }: {
  open: boolean
  watch: QuickSellTarget | null
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
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Reset when a different watch is opened. The estimate is stored in GBP, so
  // it is converted into whichever currency the field is currently showing.
  const [lastId, setLastId] = useState<string | null>(null)
  if (watch && watch.id !== lastId) {
    setLastId(watch.id)
    setCurrency(display)
    setAmount(watch.estSaleGbp !== null ? String(fromBase(watch.estSaleGbp, display, rates) / 100) : '')
    setInvoiceNo('')
    setSaleDate(toDateInput(new Date()))
    setErrors({})
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
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!amount || !invoiceNo}>Record sale</Button>
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
          options={SALE_CHANNELS.map((c) => ({ value: c, label: SALE_CHANNEL_LABELS[c] }))}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 rounded-md bg-teal-100 px-4 py-3" aria-live="polite">
        <span className="text-caption font-semibold text-content-accent">Profit on this sale</span>
        <span className="text-h3 font-extrabold tabular-nums text-content-accent">
          {projection ? `${signed(projection.profit)} · ${formatPct(projection.margin)}` : '—'}
        </span>
      </div>
    </Modal>
  )
}
