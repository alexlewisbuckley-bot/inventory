'use client'
import { useEffect, useState } from 'react'
import { Modal, Button, RadioCard, TextareaField, Chip, useToast } from '@/components/ui'
import { moveWatchesAction } from '@/app/actions/watches'
import { LOCATION_TYPE_LABELS, type LocationType } from '@/lib/enums'

interface LocationOption { id: string; name: string; type: LocationType; city: string | null }

/**
 * Single-watch move.
 *
 * Locations are fetched when the modal opens rather than passed down, so the
 * list is always current even if someone added a location in another tab.
 */
export function MoveWatchModal({ open, onClose, watchId, stockNo, model, currentLocationId, onMoved }: {
  open: boolean
  onClose: () => void
  watchId: string
  stockNo: number
  model: string
  currentLocationId: string
  onMoved: () => void
}) {
  const toast = useToast()
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [selected, setSelected] = useState<string>('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) { setSelected(''); setReason(''); return }
    fetch('/api/locations')
      .then((r) => (r.ok ? r.json() : { locations: [] }))
      .then((data: { locations: LocationOption[] }) => setLocations(data.locations ?? []))
      .catch(() => setLocations([]))
  }, [open])

  const submit = async () => {
    if (!selected) return
    setBusy(true)
    const data = new FormData()
    data.append('watchIds', watchId)
    data.set('toLocationId', selected)
    data.set('reason', reason)
    const result = await moveWatchesAction({ ok: false }, data)
    setBusy(false)
    if (result.ok) { onClose(); onMoved() }
    else toast.error('Could not move the watch', result.message)
  }

  const destination = locations.find((l) => l.id === selected)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Move watch"
      description={`Stock No. ${stockNo} · ${model}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!selected}>
            {destination ? `Move to ${destination.name}` : 'Move'}
          </Button>
        </>
      }
    >
      <fieldset>
        <legend className="mb-3 text-caption font-semibold text-content-secondary">
          Where is this watch going?
        </legend>
        <div role="radiogroup" className="flex flex-col gap-2.5">
          {locations.map((location) => (
            <RadioCard
              key={location.id}
              checked={selected === location.id}
              onSelect={() => setSelected(location.id)}
              disabled={location.id === currentLocationId}
              title={location.name}
              description={[LOCATION_TYPE_LABELS[location.type], location.city].filter(Boolean).join(' · ')}
              badge={location.id === currentLocationId ? <Chip tone="neutral">Current</Chip> : undefined}
            />
          ))}
          {locations.length === 0 && (
            <p className="text-small text-content-secondary">Loading locations…</p>
          )}
        </div>
      </fieldset>

      <TextareaField
        className="mt-4"
        label="Reason"
        hint="Logged in the watch's activity history."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Moving to the Dubai showroom for display"
        rows={2}
      />
    </Modal>
  )
}
