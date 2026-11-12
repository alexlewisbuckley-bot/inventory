'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import Link from 'next/link'
import {
  Building2, Check, Copy, Gift, KeyRound, Link2, Mail, Pencil, Phone, Trash2,
} from 'lucide-react'
import {
  Button, Card, Chip, ConfirmDialog, EmptyState, Modal, SelectField, TextField,
  TextareaField, useCreateFlag, useCurrency, useToast,
} from '@/components/ui'
import {
  savePartnerAction, deletePartnerAction, setPortalAccessAction, closePortalAction,
} from '@/app/actions/partners'
import type { ActionState } from '@/app/actions/auth'
import { CURRENCIES, type CurrencyCode } from '@/lib/enums'
import { MAX_DISCOUNT_BPS, isFloored, partnerPrice, percentFromBps } from '@/lib/partner-rate'

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
  /** The link staff hand over. Null until somebody opens a portal. */
  portalToken: string | null
  /** Whether a passphrase is set. Never the passphrase itself. */
  portalOpen: boolean
  campaignCount: number
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
export function PartnerManager({ partners, canManage, sampleAsking, sampleTrade }: {
  partners: PartnerRow[]
  canManage: boolean
  /**
   * The asking price of a watch currently in stock, for showing what a rate
   * is worth. A percentage is abstract; "AED 120,000 becomes AED 110,400" is
   * the thing somebody is actually agreeing to.
   */
  sampleAsking: number | null
  /** That watch's trade price, so the example obeys the floor the real ones do. */
  sampleTrade: number | null
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
                  {/* The name is the way in. Campaigns, their people and the
                      links we send out all live a level down, and a card with
                      nothing clickable on it is where somebody looks for them
                      and gives up. */}
                  <Link
                    href={`/partners/${partner.id}`}
                    className="truncate text-body font-bold text-content-primary hover:underline"
                  >
                    {partner.name}
                  </Link>
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
                      {money(partnerPrice(sampleAsking, partner.discountBps, sampleTrade))}
                    </span>{' '}
                    to them.
                    {isFloored(sampleAsking, partner.discountBps, sampleTrade) && (
                      /*
                       * Said out loud, because the arithmetic has stopped
                       * matching the headline. Somebody checking a rate
                       * against a figure that is quietly the trade price
                       * would otherwise conclude the percentage is wrong.
                       */
                      <span className="mt-1 block text-caption">
                        Held at the trade price — the rate would have gone below it.
                      </span>
                    )}
                  </p>
                )}

                <PortalRow partner={partner} canManage={canManage} />

                <Link
                  href={`/partners/${partner.id}`}
                  className="flex items-center gap-1.5 text-small text-content-secondary hover:text-content-primary"
                >
                  <Gift className="h-3.5 w-3.5" aria-hidden />
                  {partner.campaignCount > 0
                    ? `${partner.campaignCount} ${partner.campaignCount === 1 ? 'campaign' : 'campaigns'}`
                    : 'Set up a reward campaign'}
                </Link>

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

/**
 * The portal door, on the partner's card.
 *
 * Three states and they look different, because the difference matters: no
 * door at all, a door with a link to hand over, and the moment just after a
 * passphrase is set — which is the only time anybody will ever see it.
 */
function PortalRow({ partner, canManage }: { partner: PartnerRow; canManage: boolean }) {
  const toast = useToast()
  const [opening, setOpening] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const link = partner.portalToken
    ? `${typeof window === 'undefined' ? '' : window.location.origin}/p/${partner.portalToken}`
    : null

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // A clipboard that refuses is not an error worth a dialog: the link is
      // on the screen and can be selected by hand.
      toast.error('Could not copy', 'Select the link and copy it by hand.')
    }
  }

  const close = async () => {
    setBusy(true)
    const result = await closePortalAction(partner.id)
    setBusy(false)
    if (result.ok) toast.success('Portal closed', result.message)
    else toast.error('Could not close that portal', result.message)
  }

  return (
    <div className="rounded-md border border-line-subtle px-3 py-2.5">
      {partner.portalOpen && link ? (
        <>
          <p className="flex items-center gap-1.5 text-caption font-semibold text-content-secondary">
            <Link2 className="h-3.5 w-3.5" aria-hidden />
            Portal open
          </p>
          <button
            type="button"
            onClick={() => void copy()}
            className="mt-1 flex w-full items-center gap-1.5 text-left text-small text-content-secondary hover:text-content-primary"
          >
            <span className="truncate font-mono text-caption">{link}</span>
            {copied
              ? <Check className="h-3.5 w-3.5 shrink-0 text-state-success" aria-hidden />
              : <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="sr-only">Copy the portal link</span>
          </button>
          {canManage && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpening(true)}>
                New passphrase
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void close()} disabled={busy}>
                Close
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-caption text-content-secondary">
            No portal. They cannot see stock or reserve anything yet.
          </p>
          {canManage && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-1.5"
              icon={<KeyRound className="h-4 w-4" />}
              onClick={() => setOpening(true)}
            >
              Open a portal
            </Button>
          )}
        </>
      )}

      {opening && (
        <PassphraseForm
          partner={partner}
          onDone={() => setOpening(false)}
        />
      )}
    </div>
  )
}

/**
 * Setting the passphrase, and showing the link once.
 *
 * The passphrase is hashed and never read back, so this dialog is the only
 * moment it and the link exist in the same place. It stays open on success
 * with both on screen rather than closing with a toast, because a toast that
 * vanishes after four seconds is how somebody ends up setting a second
 * passphrase ten minutes later.
 */
function PassphraseForm({ partner, onDone }: { partner: PartnerRow; onDone: () => void }) {
  const [state, action] = useFormState(setPortalAccessAction, INITIAL)
  const [phrase, setPhrase] = useState('')

  const token = state.ok ? state.message : null
  const link = token
    ? `${typeof window === 'undefined' ? '' : window.location.origin}/p/${token}`
    : null

  return (
    <Modal
      open
      title={partner.portalOpen ? `New passphrase for ${partner.name}` : `Open a portal for ${partner.name}`}
      onClose={onDone}
    >
      {link ? (
        <div className="space-y-4">
          <p className="text-small text-content-secondary">
            Hand these over together. The passphrase cannot be shown again — if it is
            lost, set a new one.
          </p>
          <div className="space-y-1">
            <p className="text-caption font-semibold text-content-secondary">Link</p>
            <p className="break-all rounded-md bg-surface-subtle px-3 py-2 font-mono text-caption text-content-primary">
              {link}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-caption font-semibold text-content-secondary">Passphrase</p>
            <p className="rounded-md bg-surface-subtle px-3 py-2 font-mono text-caption text-content-primary">
              {phrase}
            </p>
          </div>
          <p className="text-caption text-content-secondary">
            Everybody already signed in on an old passphrase has been signed out.
          </p>
          <div className="flex justify-end">
            <Button onClick={onDone}>Done</Button>
          </div>
        </div>
      ) : (
        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={partner.id} />
          <TextField
            name="passphrase"
            label="Passphrase"
            required
            autoComplete="off"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            error={state.errors?.passphrase}
            hint="At least 12 characters. A short phrase is easier to read down a phone than a complicated word."
          />
          {state.message && !state.ok && (
            <p role="alert" className="text-small text-state-danger">{state.message}</p>
          )}
          <div className="flex justify-end gap-2.5">
            <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
            <SavePhrase open={partner.portalOpen} />
          </div>
        </form>
      )}
    </Modal>
  )
}

function SavePhrase({ open }: { open: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      {open ? 'Change it' : 'Open the portal'}
    </Button>
  )
}
