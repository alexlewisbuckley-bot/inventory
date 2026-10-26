'use client'
import { useState } from 'react'
import { Button, ComboSelect, Modal, SelectField, TextField, TextareaField, useToast } from '@/components/ui'
import { amendBrokerageAction, linkCommissionWatchAction, voidBrokerageAction } from '@/app/actions/watches'
import { PAYMENT_STATUSES, PAYMENT_STATUS_LABELS } from '@/lib/enums'

/**
 * The two things you can do to a commission after recording it.
 *
 * Kept apart from the sale dialogs because a commission is not a sale:
 * there is no cost to correct, no channel, no invoice to reissue. Offering
 * "Correct this sale" on one opened a form editing a record that does not
 * exist, showing Stock 0 and a cost of nothing.
 */

export function LinkWatchModal({ open, target, stock, onClose, onDone }: {
  open: boolean
  target: { id: string; label: string } | null
  stock: Array<{ id: string; label: string }>
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [watchId, setWatchId] = useState('')
  const [busy, setBusy] = useState(false)

  if (!target) return null

  async function submit() {
    if (!watchId) { toast.error('Choose a watch', 'Or close this if the watch was never ours.'); return }
    setBusy(true)
    const result = await linkCommissionWatchAction({ brokerageId: target!.id, watchId })
    setBusy(false)
    if (!result.ok) { toast.error('Could not link that watch', result.message); return }
    toast.success('Linked', result.message)
    setWatchId('')
    onClose()
    onDone()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link one of our watches"
      description={target.label}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-small text-content-secondary">
          For a fee earned on a piece that was on our own book. The watch will be marked
          sold, which takes it out of the stock list and off the website.
        </p>
        <ComboSelect
          name="watchId"
          label="Watch"
          placeholder="A watch from our stock"
          options={stock.map((item) => ({ value: item.id, label: item.label }))}
          value={watchId}
          onChange={setWatchId}
          emptyMessage="No stock matches."
        />
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={() => { void submit() }} loading={busy}>Link and mark sold</Button>
        </div>
      </div>
    </Modal>
  )
}

export function VoidCommissionModal({ open, target, onClose, onDone }: {
  open: boolean
  target: { id: string; label: string } | null
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  if (!target) return null

  async function submit() {
    setBusy(true)
    const result = await voidBrokerageAction(target!.id, reason)
    setBusy(false)
    if (!result.ok) { toast.error('Could not void that commission', result.message); return }
    toast.success('Commission voided', 'It no longer counts towards any figure.')
    setReason('')
    onClose()
    onDone()
  }

  return (
    <Modal open={open} onClose={onClose} title="Void this commission" description={target.label} size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-small text-content-secondary">
          Kept on the record and excluded from every figure, the same way a voided sale is.
          {/* Said plainly, because the two are easy to assume away from each other. */}
          {' '}Any watch linked to it stays sold.
        </p>
        <TextareaField
          name="reason"
          label="Reason"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Fee was never paid"
        />
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" variant="danger" onClick={() => { void submit() }} loading={busy}>
            Void commission
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Correcting the paperwork on a commission.
 *
 * The missing third verb. A commission could be linked or voided and nothing
 * else, so the reference was fixed at the moment of recording — and the
 * invoice almost always arrives afterwards. Putting it on the record meant
 * voiding the commission and entering it again, which is a poor trade for a
 * number somebody now has in front of them.
 *
 * Deliberately not the record form. That one takes the fee, the currency and
 * the rate, and re-deriving income is a different act from writing down an
 * invoice number. The fee is shown here as text, so it is clear what is being
 * corrected and what is not.
 */
export function EditCommissionModal({ open, target, onClose, onDone }: {
  open: boolean
  target: {
    id: string
    label: string
    /** The ledger prints an em dash for a reference nobody filled in. */
    reference: string
    paymentStatus: string
    brokeredOn: string
    notes: string
    fee: string
  } | null
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [reference, setReference] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('PAID')
  const [brokeredOn, setBrokeredOn] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  // Which commission the fields were last filled from, so re-opening on a
  // different row reloads them and typing into them does not.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  if (!target) return null

  if (loadedFor !== target.id) {
    setLoadedFor(target.id)
    setReference(target.reference)
    setPaymentStatus(target.paymentStatus)
    setBrokeredOn(target.brokeredOn)
    setNotes(target.notes)
  }

  async function submit() {
    setBusy(true)
    const result = await amendBrokerageAction(target!.id, {
      reference, paymentStatus, brokeredOn, notes,
    })
    setBusy(false)
    if (!result.ok) { toast.error('Could not update that commission', result.message); return }
    toast.success('Commission updated', result.message)
    onClose()
    onDone()
  }

  return (
    <Modal open={open} onClose={onClose} title="Correct this commission" description={target.label} size="sm">
      <div className="flex flex-col gap-4">
        <TextField
          name="reference"
          label="Invoice or reference"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="INV-2026-0042"
          hint="The invoice the fee was billed on. Add it whenever it arrives."
        />
        <SelectField
          name="paymentStatus"
          label="Payment"
          value={paymentStatus}
          onChange={(event) => setPaymentStatus(event.target.value)}
          options={PAYMENT_STATUSES.map((status) => ({
            value: status, label: PAYMENT_STATUS_LABELS[status],
          }))}
        />
        <TextField
          name="brokeredOn"
          type="date"
          label="Date"
          value={brokeredOn}
          onChange={(event) => setBrokeredOn(event.target.value)}
        />
        <TextareaField
          name="notes"
          label="Notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <p className="text-caption text-content-secondary">
          The fee stays at {target.fee}. It is what the reports add up, and restating income
          is a void and a re-entry rather than an edit here.
        </p>
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={() => { void submit() }} loading={busy}>Save</Button>
        </div>
      </div>
    </Modal>
  )
}
