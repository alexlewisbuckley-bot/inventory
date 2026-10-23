'use client'
import { useState } from 'react'
import { Button, ComboSelect, Modal, TextareaField, useToast } from '@/components/ui'
import { linkCommissionWatchAction, voidBrokerageAction } from '@/app/actions/watches'

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
