'use client'
import { useMemo, useState } from 'react'
import { Modal, Button, TextField, SelectField, TextareaField, useToast } from '@/components/ui'
import { recordSaleAction } from '@/app/actions/watches'
import { formatMoney, formatSigned, formatPct, parseMoneyInput } from '@/lib/money'
import { formatDate, toDateInput } from '@/lib/dates'
import { SALE_CHANNELS, SALE_CHANNEL_LABELS } from '@/lib/enums'
import type { DrawerRecord } from './WatchDrawerClient'

/**
 * Record a sale.
 *
 * Profit is recalculated live as the user types so they see the outcome before
 * committing — the single most important number in the workflow, and the one
 * the spreadsheet made them work out by hand.
 */
export function RecordSaleModal({ open, onClose, watch, onRecorded }: {
  open: boolean
  onClose: () => void
  watch: DrawerRecord
  onRecorded: () => void
}) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [saleDate, setSaleDate] = useState(toDateInput(new Date()))
  const [channel, setChannel] = useState('RETAIL')
  const [customerName, setCustomerName] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const projection = useMemo(() => {
    const saleMinor = parseMoneyInput(amount)
    const cost = watch.purchasePriceUsd
    if (saleMinor === null || cost === null) return null
    const profit = saleMinor - cost
    return {
      profit,
      margin: (profit / cost) * 100,
      vsEstimate: watch.estSaleUsd !== null ? saleMinor - watch.estSaleUsd : null,
    }
  }, [amount, watch.purchasePriceUsd, watch.estSaleUsd])

  const submit = async () => {
    setBusy(true)
    setErrors({})
    const data = new FormData()
    data.set('watchId', watch.id)
    data.set('invoiceNo', invoiceNo)
    data.set('saleDate', saleDate)
    data.set('saleAmountUsd', String(parseMoneyInput(amount) ? parseMoneyInput(amount)! / 100 : ''))
    data.set('channel', channel)
    data.set('customerName', customerName)
    data.set('notes', notes)
    const result = await recordSaleAction({ ok: false }, data)
    setBusy(false)
    if (result.ok) { onClose(); onRecorded() }
    else {
      setErrors(result.errors ?? {})
      if (result.message) toast.error('Could not record the sale', result.message)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a sale"
      description={`Stock No. ${watch.stockNo} · ${watch.brandName} ${watch.model} — this moves the watch to Sold`}
      size="lg"
      dismissible={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!amount || !invoiceNo}>
            Record sale — move to Sold
          </Button>
        </>
      }
    >
      <div className="mb-5 flex items-center justify-between gap-4 rounded-md bg-surface-subtle px-4 py-3.5">
        <div className="min-w-0">
          <p className="truncate text-body font-bold text-content-primary">
            {watch.model}{watch.serial ? ` · Serial ${watch.serial}` : ''}
          </p>
          <p className="text-caption text-content-secondary">
            Bought {formatDate(watch.purchaseDate)} · {formatMoney(watch.purchasePriceGbp, 'GBP')} ({formatMoney(watch.purchasePriceUsd, 'USD')}) · {watch.supplierName}
          </p>
        </div>
        {watch.estSaleUsd !== null && (
          <div className="shrink-0 text-right">
            <p className="text-small font-bold text-navy-700">Est. {formatMoney(watch.estSaleUsd, 'USD')}</p>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Sale date" type="date" required
          value={saleDate} onChange={(e) => setSaleDate(e.target.value)}
          error={errors.saleDate}
        />
        <TextField
          label="Invoice number" required
          value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)}
          placeholder="INV-2026-118" error={errors.invoiceNo}
        />
        <TextField
          label="Sale amount (USD)" required inputMode="decimal" prefix="$"
          value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder="18,900.00" error={errors.saleAmountUsd}
        />
        <SelectField
          label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}
          options={SALE_CHANNELS.map((c) => ({ value: c, label: SALE_CHANNEL_LABELS[c] }))}
        />
        <TextField
          label="Customer name" className="sm:col-span-2"
          value={customerName} onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Optional"
        />
      </div>

      <div
        className="mt-5 flex items-center justify-between gap-4 rounded-md bg-teal-100 px-4 py-4"
        aria-live="polite"
      >
        <div>
          <p className="text-caption font-semibold text-content-accent">Realised profit</p>
          <p className="text-micro text-content-secondary">Calculated automatically — sale minus purchase</p>
        </div>
        <div className="text-right">
          {projection ? (
            <>
              <p className="text-h3 font-extrabold text-content-accent tabular-nums">
                {formatSigned(projection.profit, 'USD')} · {formatPct(projection.margin)}
              </p>
              {projection.vsEstimate !== null && (
                <p className="text-micro text-content-secondary">
                  {projection.vsEstimate === 0
                    ? 'Exactly on estimate'
                    : `${formatMoney(Math.abs(projection.vsEstimate), 'USD')} ${projection.vsEstimate > 0 ? 'ahead of' : 'below'} estimate`}
                </p>
              )}
            </>
          ) : (
            <p className="text-small text-content-secondary">Enter a sale amount</p>
          )}
        </div>
      </div>

      <TextareaField
        className="mt-4" label="Notes" rows={2}
        value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything worth recording about this sale"
      />
    </Modal>
  )
}
