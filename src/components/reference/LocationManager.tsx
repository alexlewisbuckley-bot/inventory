'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Card, Button, Modal, TextField, TextareaField, SelectField, Checkbox,
  Chip, ConfirmDialog, EmptyState, useToast, useCreateFlag,
} from '@/components/ui'
import { saveLocationAction, deleteLocationAction } from '@/app/actions/reference'
import type { ActionState } from '@/app/actions/auth'
import { formatMoney } from '@/lib/money'
import { LOCATION_TYPES, LOCATION_TYPE_LABELS, locationTypeCaption, type LocationType } from '@/lib/enums'

export interface LocationRow {
  id: string
  name: string
  type: LocationType
  city: string | null
  country: string | null
  addressLine: string | null
  notes: string | null
  isActive: boolean
  watchCount: number
  valueGbp: number
}

const INITIAL: ActionState = { ok: false }

/**
 * Locations as cards rather than a table.
 *
 * There are only ever a handful, and each one carries a stock count and capital
 * figure that deserves more visual weight than a table row would give it.
 */
export function LocationManager({ locations, canManage }: { locations: LocationRow[]; canManage: boolean }) {
  const toast = useToast()
  const [editing, setEditing] = useState<LocationRow | null>(null)
  // Opening state lives in the URL so the header button, the empty state
  // and a deep link all reach the same form.
  const create = useCreateFlag()
  const [deleting, setDeleting] = useState<LocationRow | null>(null)
  const [busy, setBusy] = useState(false)

  const totalValue = locations.reduce((sum, l) => sum + l.valueGbp, 0)

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    const result = await deleteLocationAction(deleting.id)
    setBusy(false)
    setDeleting(null)
    if (result.ok) toast.success('Location deleted')
    else toast.error('Could not delete location', result.message)
  }

  return (
    <>
      {locations.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MapPin className="h-6 w-6" />}
            title="No locations yet"
            description="Add your stores and vaults so stock can be assigned and transfers tracked."
            action={canManage ? <Button onClick={() => create.openIt()}>Add location</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {locations.map((location) => {
            const share = totalValue > 0 ? (location.valueGbp / totalValue) * 100 : 0
            return (
              <Card key={location.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-3 px-6 pt-5">
                  <div className="min-w-0">
                    <h2 className="truncate text-h3 font-extrabold text-content-primary">{location.name}</h2>
                    {/* Two lines, always: every card in the row reserves the
                        same header height so the figures below line up, and an
                        address no longer ends in "United Kingdo…". */}
                    <p className="mt-0.5 line-clamp-2 min-h-[2.4em] text-caption text-content-secondary" title={[
                      LOCATION_TYPE_LABELS[location.type], location.city, location.country,
                    ].filter(Boolean).join(' · ')}>
                      {[
                        locationTypeCaption(location.name, location.type),
                        location.city,
                        location.country,
                      ].filter(Boolean).join(' · ') || 'No address recorded'}
                    </p>
                  </div>
                  <Chip tone={location.isActive ? 'accent' : 'neutral'} dot={location.isActive}>
                    {location.isActive ? 'Active' : 'Inactive'}
                  </Chip>
                </div>

                <div className="flex items-end gap-8 px-6 pt-5">
                  <div>
                    <p className="text-caption font-semibold text-content-secondary">Watches</p>
                    <p className="mt-1 text-h2 font-extrabold tabular-nums text-content-primary">{location.watchCount}</p>
                  </div>
                  <div>
                    <p className="text-caption font-semibold text-content-secondary">Capital held</p>
                    <p className="mt-1 text-h3 font-extrabold tabular-nums text-content-primary">
                      {formatMoney(location.valueGbp, 'GBP')}
                    </p>
                  </div>
                </div>

                <div className="mt-4 px-6">
                  <div className="h-1.5 overflow-hidden rounded-pill bg-surface-subtle" role="presentation">
                    <div className="h-full rounded-pill bg-teal-500" style={{ width: `${Math.max(share, share > 0 ? 4 : 0)}%` }} />
                  </div>
                  <p className="mt-1.5 text-micro text-content-secondary">
                    {share.toFixed(0)}% of capital across all locations
                  </p>
                </div>

                {location.notes && (
                  <p className="mt-4 px-6 text-caption text-content-secondary">{location.notes}</p>
                )}

                <div className="mt-auto flex items-center justify-between gap-2 border-t border-line-subtle px-6 py-3.5">
                  <Link href={`/inventory?locationId=${location.id}`} className="text-small font-bold text-content-accent hover:underline">
                    View stock →
                  </Link>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setEditing(location)} aria-label={`Edit ${location.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-subtle hover:text-content-primary">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setDeleting(location)} aria-label={`Delete ${location.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-sm text-content-secondary hover:bg-state-danger/10 hover:text-state-danger">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <LocationFormModal
        open={create.open || editing !== null}
        location={editing}
        onClose={() => { create.close(); setEditing(null) }}
        onSaved={(message) => { toast.success(message); create.close(); setEditing(null) }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={busy}
        title={`Delete ${deleting?.name}?`}
        message={
          deleting && deleting.watchCount > 0
            ? `${deleting.name} still holds ${deleting.watchCount} watches. Move them elsewhere first, or deactivate the location instead.`
            : 'The location will be removed. Past stock movements keep their history.'
        }
        confirmLabel="Delete location"
      />
    </>
  )
}

function LocationFormModal({ open, location, onClose, onSaved }: {
  open: boolean
  location: LocationRow | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [state, action] = useFormState(saveLocationAction, INITIAL)
  const [wasOpen, setWasOpen] = useState(false)

  if (state.ok && open && !wasOpen) {
    setWasOpen(true)
    onSaved(state.message ?? 'Saved')
  }
  if (!open && wasOpen) setWasOpen(false)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={location ? `Edit ${location.name}` : 'Add a location'}
      description="Locations appear in the move dialog and on every stock row."
      footer={<LocationFooter onClose={onClose} isEdit={Boolean(location)} formId="location-form" />}
    >
      <form id="location-form" action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
        {location && <input type="hidden" name="id" value={location.id} />}
        <TextField name="name" label="Location name" required defaultValue={location?.name ?? ''}
          className="sm:col-span-2" error={state.errors?.name} placeholder="e.g. One Street Watches" />
        <SelectField name="type" label="Type" defaultValue={location?.type ?? 'STORE'}
          options={LOCATION_TYPES.map((t) => ({ value: t, label: LOCATION_TYPE_LABELS[t] }))} />
        <TextField name="city" label="City" defaultValue={location?.city ?? ''} placeholder="e.g. Dubai" />
        <TextField name="addressLine" label="Address" className="sm:col-span-2" defaultValue={location?.addressLine ?? ''} />
        <TextField name="country" label="Country" defaultValue={location?.country ?? ''} />
        <TextareaField name="notes" label="Notes" className="sm:col-span-2" defaultValue={location?.notes ?? ''}
          placeholder="e.g. Retail showroom — display stock only" />
        <div className="sm:col-span-2">
          <Checkbox name="isActive" label="Active"
            hint="Inactive locations cannot receive new stock but keep their history."
            defaultChecked={location?.isActive ?? true} />
        </div>
      </form>
    </Modal>
  )
}

function LocationFooter({ onClose, isEdit, formId }: { onClose: () => void; isEdit: boolean; formId: string }) {
  const { pending } = useFormStatus()
  return (
    <>
      <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
      <Button type="submit" form={formId} loading={pending}>{isEdit ? 'Save changes' : 'Add location'}</Button>
    </>
  )
}
