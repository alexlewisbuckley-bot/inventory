'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, Button, TextareaField, useToast } from '@/components/ui'
import { voidSaleAction } from '@/app/actions/watches'

export interface VoidTarget {
  id: string
  stockNo: number
  label: string
}

/**
 * Reverse a sale.
 *
 * The sale row is kept and marked void rather than deleted — an invoice that
 * was issued and then cancelled is a fact, and the reason is worth more than
 * the row's absence. Reports exclude voided sales, so the figures move as if
 * it never completed.
 */
export function VoidSaleModal({ open, target, onClose, onVoided }: {
  open: boolean
  target: VoidTarget | null
  onClose: () => void
  onVoided: () => void
}) {
  const toast = useToast()
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  if (!target) return null

  const submit = async () => {
    setBusy(true)
    const result = await voidSaleAction(target.id, reason)
    setBusy(false)
    if (result.ok) {
      toast.success('Sale voided', `Stock ${target.stockNo} is back in stock.`)
      setReason('')
      onClose()
      onVoided()
      router.refresh()
    } else {
      toast.error('Could not void the sale', result.message)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Void this sale?"
      description={`Stock ${target.stockNo} · ${target.label}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Keep the sale</Button>
          <Button variant="danger" onClick={submit} loading={busy}>Void the sale</Button>
        </>
      }
    >
      <p className="mb-4 text-small text-content-secondary">
        The watch returns to stock and the sale stops counting towards revenue, profit and
        margin. The invoice is kept and marked void, so the correction stays on the record
        rather than the sale simply vanishing from reports somebody has already read.
      </p>
      <TextareaField
        label="Why?"
        rows={2}
        hint="Optional, but the next person reading the audit trail will thank you."
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="e.g. Recorded against the wrong stock number"
      />
    </Modal>
  )
}
