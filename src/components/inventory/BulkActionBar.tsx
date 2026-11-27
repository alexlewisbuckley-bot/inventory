'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft, Download, Trash2, X } from 'lucide-react'
import { Button, Modal, SelectField, TextareaField, ConfirmDialog, useToast } from '@/components/ui'
import { moveWatchesAction, deleteWatchAction, restoreWatchAction } from '@/app/actions/watches'
import { GroupPostBatch } from './GroupPostBatch'
import type { Capability } from '@/lib/permissions'

/**
 * Floating action bar shown while rows are selected.
 *
 * Anchored to the viewport bottom so it stays reachable however far the user
 * has scrolled, and it reports the selection count for screen readers.
 */
export function BulkActionBar({
  count, watchIds, locations, capabilities, onClear, allMatching = false,
}: {
  count: number
  watchIds: string[]
  locations: Array<{ id: string; name: string }>
  capabilities: Record<Capability, boolean>
  onClear: () => void
  /**
   * The selection is "everything matching the filter", not a list of ids.
   *
   * The destructive verbs are withheld in that mode until the server can act
   * on a filter rather than on ids. Offering Delete here and quietly applying
   * it to only the loaded page would be worse than not offering it — the bar
   * would say 312 and remove 25, and nobody would find out until the next
   * report disagreed.
   */
  allMatching?: boolean
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
      {/*
        On a phone the bar sat at bottom-6 — behind the bottom navigation — and
        was wider than the screen, so the count and Delete fell off either
        side. Below md it now spans the screen above the navigation and stacks:
        count and clear on top, the verbs beneath, with Move, Export and
        Delete as icons. From md up it is the single centred row it always was.
      */}
      <div
        role="region"
        aria-label={`${count} selected`}
        className={
          'fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4rem)] z-40 flex flex-wrap items-center gap-2 '
          + 'rounded-sm border border-line-subtle bg-surface-raised px-3 py-2.5 shadow-raised animate-slide-up '
          + 'md:inset-x-auto md:left-1/2 md:w-max md:max-w-[calc(100vw-1.5rem)] md:-translate-x-1/2 md:flex-nowrap md:gap-3 md:px-4 md:py-3 '
          + 'lg:bottom-6'
        }
      >
        <span className="flex-1 pl-1 text-small font-bold text-content-primary md:flex-none md:pl-2" aria-live="polite">
          {count} selected
        </span>
        <span className="hidden h-5 w-px bg-line-subtle md:block" aria-hidden />

        <div className="order-last flex w-full flex-wrap items-center gap-1 md:order-none md:contents">
          {allMatching && (
            // Said plainly rather than hidden behind a disabled button. The
            // operator asked for three hundred rows and is being told which
            // verbs can honour that, which is more useful than three greyed-out
            // controls and no explanation.
            <span className="text-caption text-content-secondary md:max-w-[220px]">
              Moving and deleting work on rows you have picked. Narrow the filter, or select a page.
            </span>
          )}

          {/* First, because a selection made from the list is most often made
              in order to put those pieces out. Picked rows only: a batch has
              to be walked through one tap at a time, so "everything matching
              the filter" is not a thing anybody wants to start. */}
          {!allMatching && capabilities['watch:broadcast'] && (
            <GroupPostBatch watchIds={watchIds} onDone={onClear} />
          )}

          {!allMatching && capabilities['watch:move'] && (
            <Button size="sm" variant="ghost" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setMoveOpen(true)}
              className="ml-auto md:ml-0">
              <span className="sr-only sm:not-sr-only">Move</span>
            </Button>
          )}
          {!allMatching && capabilities['report:export'] && (
            <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} onClick={exportSelection}>
              <span className="sr-only sm:not-sr-only">Export</span>
            </Button>
          )}
          {!allMatching && capabilities['watch:delete'] && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleteOpen(true)}
              className="text-state-danger hover:bg-state-danger/8">
              <span className="sr-only sm:not-sr-only">Delete</span>
            </Button>
          )}
        </div>

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
