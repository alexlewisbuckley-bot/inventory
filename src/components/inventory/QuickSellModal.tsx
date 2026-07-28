'use client'
import { useMemo, useState } from 'react'
import { Modal, Button, TextField, SelectField, useToast } from '@/components/ui'
import { recordSaleAction } from '@/app/actions/watches'
import { formatMoney, formatSigned, formatPct, parseMoneyInput } from '@/lib/money'
import { toDateInput } from '@/lib/dates'
import { SALE_CHANNELS, SALE_CHANNEL_LABELS } from '@/lib/enums'

export interface QuickSellTarget {
  id: string
  stockNo: number
  model: string
  brandName: string
  purchasePriceUsd: number | null
  purchasePriceGbp: number
  estSaleUsd: number | null
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
  const [amount, setAmount] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [saleDate, setSaleDate] = useState(toDateInput(new Date()))
  const [channel, setChannel] = useState('RETAIL')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Reset when a different watch is opened.
  const [lastId, setLastId] = useState<string | null>(null)
  if (watch && watch.id !== lastId) {
    setLastId(watch.id)
    setAmount(watch.estSaleUsd !== null ? String(watch.estSaleUsd / 100) : '')
    setInvoiceNo('')
    setSaleDate(toDateInput(new Date()))
    setErrors({})
  }

  const projection = useMemo(() => {
    if (!watch) return null
    const sale = parseMoneyInput(amount)
    const cost = watch.purchasePriceUsd
    if (sale === null || cost === null || cost === 0) return null
    const profit = sale - cost
    return { profit, margin: (profit / cost) * 100 }
  }, [amount, watch])

  if (!watch) return null

  const submit = async () => {
    setBusy(true)
    setErrors({})
    const data = new FormData()
    const minor = parseMoneyInput(amount)
    data.set('watchId', watch.id)
    data.set('invoiceNo', invoiceNo)
    data.set('saleDate', saleDate)
    data.set('saleAmountUsd', minor !== null ? String(minor / 100) : '')
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
        <span className="text-small font-bold text-content-primary">
          {formatMoney(watch.purchasePriceGbp, 'GBP')}
          {watch.purchasePriceUsd !== null && ` · ${formatMoney(watch.purchasePriceUsd, 'USD')}`}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Sale amount (USD)" required inputMode="decimal" prefix="$" autoFocus
          value={amount} onChange={(e) => setAmount(e.target.value)}
          hint={watch.estSaleUsd !== null ? 'Pre-filled from the estimate.' : undefined}
          error={errors.saleAmountUsd}
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
          {projection ? `${formatSigned(projection.profit, 'USD')} · ${formatPct(projection.margin)}` : '—'}
        </span>
      </div>
    </Modal>
  )
}
