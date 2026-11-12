'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Building2, Mail, Pencil, Phone, Trash2 } from 'lucide-react'
import {
  Button, Card, Chip, ConfirmDialog, EmptyState, Modal, SelectField, TextField,
  TextareaField, useCreateFlag, useCurrency, useToast,
} from '@/components/ui'
import { savePartnerAction, deletePartnerAction } from '@/app/actions/partners'
import type { ActionState } from '@/app/actions/auth'
import { CURRENCIES, type CurrencyCode } from '@/lib/enums'
import { MAX_DISCOUNT_BPS, partnerPrice, percentFromBps } from '@/lib/partner-rate'

export interface PartnerRow {
  id: string
  name: string
  displayName: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  website: string | null
  discountBps: number
  displayCurrency: CurrencyCode
  brandColor: string
  accentColor: string
  notes: string | null
  isActive: boolean
}

const INITIAL: ActionState = { ok: false }

/**
 * The partner register.
 *
 * Corporates that buy at an agreed rate and run reward campaigns for their
 * staff. Cards rather than a table, like owners and locations: there are only
 * ever a handful, and the one number that matters on each — the rate — is
 * worth more room than a column.
 */
export function PartnerManager({ partners, canManage, sampleAsking }: {
  partners: PartnerRow[]
  canManage: boolean
  /**
   * The asking price of a watch currently in stock, for showing what a rate
   * is worth. A percentage is abstract; "AED 120,000 becomes AED 110,400" is
   * the thing somebody is actually agreeing to.
   */
  sampleAsking: number | null
}) {
  const toast = useToast()
  const { money } = useCurrency()
  const create = useCreateFlag()
  const [editing, setEditing] = useState<PartnerRow | null>(null)
  const [deleting, setDeleting] = useState<PartnerRow | null>(null)
  const [busy, setBusy] = useState(false)

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    const result = await deletePartnerAction(deleting.id)
    setBusy(false)
    setDeleting(null)
    if (result.ok) toast.success('Partner removed')
    else toast.error('Could not remove that partner', result.message)
  }

  const open = create.open || editing !== null

  return (
    <>
      {partners.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-6 w-6" aria-hidden />}
          title="No partners yet"
          description="A partner is a company that buys at an agreed rate and runs reward campaigns for its staff."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {partners.map((partner) => (
            <Card key={partner.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate text-body font-bold text-content-primary">{partner.name}</p>
                  {partner.displayName && partner.displayName !== partner.name && (
                    <p className="truncate text-small text-content-secondary">
                      Shown to their people as {partner.displayName}
                    </p>
                  )}
                </div>
                {!partner.isActive && <Chip tone="neutral">Paused</Chip>}
              </div>

              <div className="flex-1 space-y-3 px-5 py-4">
                {/* The rate, large, because it is the whole of the arrangement
                    and the one thing somebody opens this page to check. */}
                <div>
                  <p className="text-display font-bold tabular-nums text-content-primary">
                    {percentFromBps(partner.discountBps)}
                  </p>
                  <p className="text-small text-content-secondary">
                    off the asking price
                    {partner.displayCurrency !== 'AED' && `, quoted in ${partner.displayCurrency}`}
                  </p>
                </div>

                {/* What that is worth against something real, so the number is
                    not abstract when it is being agreed. */}
                {sampleAsking !== null && partner.discountBps > 0 && (
                  <p className="rounded-md bg-surface-subtle px-3 py-2 text-small text-content-secondary">
                    A watch at <span className="font-bold text-content-primary">{money(sampleAsking)}</span>{' '}
                    is{' '}
                    <span className="font-bold text-content-primary">
                      {money(partnerPrice(sampleAsking, partner.discountBps))}
                    </span>{' '}
                    to them.
                  </p>
                )}

                {(partner.contactName || partner.contactEmail || partner.contactPhone) && (
                  <div className="space-y-1 text-small text-content-secondary">
                    {partner.contactName && <p className="font-semibold text-content-primary">{partner.contactName}</p>}
                    {partner.contactEmail && (
                      <p className="flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <a href={`mailto:${partner.contactEmail}`} className="truncate hover:underline">
                          {partner.contactEmail}
                        </a>
                      </p>
                    )}
                    {partner.contactPhone && (
                      <p className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {partner.contactPhone}
                      </p>
                    )}
                  </div>
                )}

                {partner.notes && <p className="text-small text-content-secondary">{partner.notes}</p>}
              </div>

              {canManage && (
                <div className="flex items-center gap-2 border-t border-line-subtle px-5 py-3">
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />}
                    onClick={() => setEditing(partner)}>
                    Edit
                  </Button>
                  <button
                    type="button"
                    aria-label={`Remove ${partner.name}`}
                    onClick={() => setDeleting(partner)}
                    className="ml-auto rounded p-1.5 text-content-muted hover:bg-surface-subtle hover:text-state-danger"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {open && (
        <PartnerForm
          partner={editing}
          onDone={() => { setEditing(null); create.close() }}
          // The toast carries the title alone: the action's own message says
          // the same words, and a toast that reads "Partner added / Partner
          // added." is a sentence repeated at somebody.
          onSaved={() => toast.success(editing ? 'Partner updated' : 'Partner added')}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Remove ${deleting?.name ?? 'this partner'}?`}
        message="Their record is kept, so anything they have bought still reads. The name is freed for a company coming back under new terms."
        confirmLabel="Remove"
        tone="danger"
        loading={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function PartnerForm({ partner, onDone, onSaved }: {
  partner: PartnerRow | null
  onDone: () => void
  onSaved: () => void
}) {
  const [state, action] = useFormState(savePartnerAction, INITIAL)
  const [percent, setPercent] = useState(partner ? String(partner.discountBps / 100) : '0')

  if (state.ok) {
    onSaved()
    onDone()
  }

  return (
    <Modal open title={partner ? `Edit ${partner.name}` : 'Add a partner'} onClose={onDone}>
      <form action={action} className="space-y-4">
        {partner && <input type="hidden" name="id" value={partner.id} />}

        <TextField name="name" label="Company name" required
          defaultValue={partner?.name ?? ''} error={state.errors?.name} />
        <TextField name="displayName" label="Shown to their people as"
          defaultValue={partner?.displayName ?? ''} error={state.errors?.displayName}
          hint="Only where it differs from the name we file them under." />

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Typed as a percentage, stored as basis points. People negotiate
              in percent; prices are worked out from the integer. */}
          <TextField
            name="discountPercent"
            label="Rate (% off the asking price)"
            inputMode="decimal"
            required
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
            error={state.errors?.discountPercent}
            hint={`Up to ${MAX_DISCOUNT_BPS / 100}%. Applied to each watch's current asking price.`}
          />
          <SelectField
            name="displayCurrency" label="Quoted in"
            defaultValue={partner?.displayCurrency ?? 'AED'}
            options={CURRENCIES.map((code) => ({ value: code, label: code }))}
            error={state.errors?.displayCurrency}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="contactName" label="Contact" defaultValue={partner?.contactName ?? ''}
            error={state.errors?.contactName} />
          <TextField name="contactEmail" label="Email" type="email" defaultValue={partner?.contactEmail ?? ''}
            error={state.errors?.contactEmail} />
          <TextField name="contactPhone" label="Telephone" defaultValue={partner?.contactPhone ?? ''}
            error={state.errors?.contactPhone} />
          <TextField name="website" label="Website" defaultValue={partner?.website ?? ''}
            error={state.errors?.website} />
        </div>

        <TextareaField name="notes" label="Notes" rows={3} defaultValue={partner?.notes ?? ''}
          error={state.errors?.notes} hint="Terms, who signed it off, anything the next person needs." />

        <input type="hidden" name="isActive" value={partner ? String(partner.isActive) : 'true'} />
        <input type="hidden" name="brandColor" value={partner?.brandColor ?? '#04173A'} />
        <input type="hidden" name="accentColor" value={partner?.accentColor ?? '#0F766E'} />

        {state.message && !state.ok && (
          <p role="alert" className="text-small text-state-danger">{state.message}</p>
        )}

        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          <SaveButton editing={partner !== null} />
        </div>
      </form>
    </Modal>
  )
}

function SaveButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus()
  return <Button type="submit" loading={pending}>{editing ? 'Save changes' : 'Add partner'}</Button>
}
