'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft, Download, Trash2, X } from 'lucide-react'
import { Button, Modal, SelectField, TextareaField, ConfirmDialog, useToast } from '@/components/ui'
import { moveWatchesAction, deleteWatchAction, restoreWatchAction } from '@/app/actions/watches'
import type { Capability } from '@/lib/permissions'
import type { FilterOption } from './FilterBar'

/**
 * Floating action bar shown while rows are selected.
 *
 * Anchored to the viewport bottom so it stays reachable however far the user
 * has scrolled, and it reports the selection count for screen readers.
 */
export function BulkActionBar({ count, watchIds, locations, capabilities, onClear }: {
  count: number
  watchIds: string[]
  locations: FilterOption[]
  capabilities: Record<Capability, boolean>
  onClear: () => void
}) {
  const toast = useToast()
  const router = useRouter()
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')

  const handleMove = async () => {
    if (!destination) return
    setBusy(true)
    const data = new FormData()
    watchIds.forEach((id) => data.append('watchIds', id))
    data.set('toLocationId', destination)
    data.set('reason', reason)
    const result = await moveWatchesAction({ ok: false }, data)
    setBusy(false)
    if (result.ok) {
      toast.success('Stock moved', result.message)
      setMoveOpen(false)
      setDestination('')
      setReason('')
      onClear()
    } else {
      toast.error('Could not move stock', result.message)
    }
  }

  /**
   * Deletion is reversible, so the confirmation is followed by an undo rather
   * than leaning on the user to find the deleted filter. The toast holds for
   * twelve seconds — long enough to notice a mistake, short enough not to
   * linger — and restores exactly the rows that were actually removed.
   */
  const handleDelete = async () => {
    setBusy(true)
    const results = await Promise.all(watchIds.map(async (id) => ({ id, result: await deleteWatchAction(id) })))
    setBusy(false)
    setDeleteOpen(false)

    const removed = results.filter((r) => r.result.ok).map((r) => r.id)
    const failed = results.length - removed.length

    if (removed.length > 0) {
      toast.toast({
        tone: 'success',
        title: `${removed.length} ${removed.length === 1 ? 'watch' : 'watches'} deleted`,
        description: failed > 0
          ? `${failed} could not be deleted — sold watches are part of the sales record.`
          : undefined,
        duration: 12_000,
        action: capabilities['watch:restore']
          ? {
            label: 'Undo',
            onClick: async () => {
              const undone = await Promise.all(removed.map((id) => restoreWatchAction(id)))
              const back = undone.filter((r) => r.ok).length
              if (back === removed.length) {
                toast.success(`${back} ${back === 1 ? 'watch' : 'watches'} restored`)
              } else {
                toast.error('Could not restore everything', `${back} of ${removed.length} came back.`)
              }
              router.refresh()
            },
          }
          : undefined,
      })
      onClear()
      router.refresh()
    } else {
      toast.error(
        `${failed} could not be deleted`,
        'Sold watches are part of the sales record and cannot be removed.',
      )
    }
  }

  const exportSelection = () => {
    const params = new URLSearchParams()
    watchIds.forEach((id) => params.append('id', id))
    window.location.href = `/api/export/watches?${params.toString()}`
  }

  return (
    <>
      <div
        role="region"
        aria-label={`${count} selected`}
        className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-pill border border-line-subtle bg-surface-raised px-4 py-3 shadow-raised animate-slide-up"
      >
        <span className="pl-2 text-small font-bold text-content-primary" aria-live="polite">
          {count} selected
        </span>
        <span className="h-5 w-px bg-line-subtle" aria-hidden />

        {capabilities['watch:move'] && (
          <Button size="sm" variant="ghost" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setMoveOpen(true)}>
            Move
          </Button>
        )}
        {capabilities['report:export'] && (
          <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} onClick={exportSelection}>
            Export
          </Button>
        )}
        {capabilities['watch:delete'] && (
          <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleteOpen(true)}
            className="text-state-danger hover:bg-state-danger/8">
            Delete
          </Button>
        )}

        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="rounded-pill p-1.5 text-content-secondary hover:bg-surface-subtle"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={`Move ${count} ${count === 1 ? 'watch' : 'watches'}`}
        description="The transfer is logged against each watch with who moved it and when."
        footer={
          <>
            <Button variant="ghost" onClick={() => setMoveOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleMove} loading={busy} disabled={!destination}>Move stock</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <SelectField
            label="Destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Choose a location…"
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
            required
          />
          <TextareaField
            label="Reason"
            hint="Optional, but useful when reconciling stock later."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Moving display stock to the Dubai showroom"
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        loading={busy}
        title={`Delete ${count} ${count === 1 ? 'watch' : 'watches'}?`}
        message="They will be hidden from the inventory but kept for audit. You can undo this straight afterwards, or restore them later from the deleted filter. Sold watches cannot be deleted."
        confirmLabel="Delete"
      />
    </>
  )
}
