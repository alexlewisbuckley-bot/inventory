'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Check, Copy, ExternalLink, Globe, Pencil, RefreshCw, Store, Trash2, Upload } from 'lucide-react'
import {
  Card, Button, Modal, TextField, TextareaField, SelectField, Checkbox,
  Chip, ConfirmDialog, EmptyState, useToast, useCreateFlag,
} from '@/components/ui'
import {
  saveResellerAction, deleteResellerAction, rotateResellerTokenAction,
  uploadResellerLogoAction, removeResellerLogoAction,
} from '@/app/actions/resellers'
import type { ActionState } from '@/app/actions/auth'
import { CURRENCIES } from '@/lib/enums'
import { parseNavLinks } from '@/lib/validation'
import { ResellerReach } from './ResellerReach'

export interface ResellerRow {
  id: string
  name: string
  displayName: string | null
  headline: string | null
  intro: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  website: string | null
  brandColor: string
  accentColor: string
  displayCurrency: string
  publicToken: string
  customDomain: string | null
  customDomainSeenAt: string | null
  isActive: boolean
  notes: string | null
  navLinks: string | null
  hasLogo: boolean
  availableCount: number
}

const INITIAL: ActionState = { ok: false }

export function ResellerManager({ resellers, canManage, origin }: {
  resellers: ResellerRow[]
  canManage: boolean
  origin: string
}) {
  const toast = useToast()
  const create = useCreateFlag()
  const [editing, setEditing] = useState<ResellerRow | null>(null)
  const [deleting, setDeleting] = useState<ResellerRow | null>(null)
  const [rotating, setRotating] = useState<ResellerRow | null>(null)
  const [reaching, setReaching] = useState<ResellerRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const linkFor = (token: string) => `${origin}/s/${token}`

  /**
   * What to put in front of them.
   *
   * Once a shop answers on the reseller's own hostname, that is the link worth
   * copying — showing the token one beside it would be showing the thing this
   * page exists to stop anybody sending to a customer.
   */
  const publicLinkFor = (row: ResellerRow) =>
    row.customDomain && row.customDomainSeenAt ? `https://${row.customDomain}` : linkFor(row.publicToken)

  const copy = async (row: ResellerRow) => {
    try {
      await navigator.clipboard.writeText(publicLinkFor(row))
      setCopied(row.id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast.error('Could not copy', 'Select the link and copy it by hand.')
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    const result = await deleteResellerAction(deleting.id)
    setBusy(false)
    setDeleting(null)
    if (result.ok) toast.success('Reseller removed', 'Their link no longer works.')
    else toast.error('Could not remove the reseller', result.message)
  }

  const confirmRotate = async () => {
    if (!rotating) return
    setBusy(true)
    const result = await rotateResellerTokenAction(rotating.id)
    setBusy(false)
    setRotating(null)
    if (result.ok) toast.success('New link issued', 'The previous link has stopped working.')
    else toast.error('Could not reissue the link', result.message)
  }

  return (
    <>
      {resellers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Store className="h-6 w-6" />}
            title="No resellers yet"
            description="Add a reseller to give them a branded, live view of the stock that is available to sell."
            action={canManage ? <Button onClick={() => create.openIt()}>Add reseller</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {resellers.map((reseller) => (
            <Card key={reseller.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3 px-6 pt-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="h-10 w-10 shrink-0 rounded-md"
                    style={{ background: `linear-gradient(135deg, ${reseller.brandColor}, ${reseller.accentColor})` }}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <h2 className="truncate text-h3 font-extrabold text-content-primary">{reseller.name}</h2>
                    <p className="truncate text-caption text-content-secondary">
                      {[reseller.contactName, reseller.contactEmail].filter(Boolean).join(' · ') || 'No contact recorded'}
                    </p>
                  </div>
                </div>
                <Chip tone={reseller.isActive ? 'accent' : 'neutral'} dot={reseller.isActive}>
                  {reseller.isActive ? 'Live' : 'Switched off'}
                </Chip>
              </div>

              <div className="flex items-end gap-8 px-6 pt-5">
                <div>
                  <p className="text-caption font-semibold text-content-secondary">Showing</p>
                  <p className="mt-1 text-h2 font-extrabold tabular-nums text-content-primary">
                    {reseller.availableCount}
                  </p>
                </div>
                <div>
                  <p className="text-caption font-semibold text-content-secondary">Priced in</p>
                  <p className="mt-1 text-h3 font-extrabold text-content-primary">{reseller.displayCurrency}</p>
                </div>
                <div>
                  <p className="text-caption font-semibold text-content-secondary">Logo</p>
                  <p className="mt-1 text-h3 font-extrabold text-content-primary">
                    {reseller.hasLogo ? 'Set' : '—'}
                  </p>
                </div>
              </div>

              {/* The link is the product of this page, so it is shown rather
                  than tucked behind an edit form. */}
              <div className="mt-5 px-6">
                <p className="text-caption font-semibold text-content-secondary">Their shop link</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-sm bg-surface-subtle px-2.5 py-2 font-mono text-caption text-content-primary">
                    {publicLinkFor(reseller)}
                  </code>
                  <button
                    type="button" onClick={() => copy(reseller)}
                    aria-label={`Copy the link for ${reseller.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-subtle hover:text-content-primary"
                  >
                    {copied === reseller.id ? <Check className="h-4 w-4 text-state-success" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <a
                    href={publicLinkFor(reseller)} target="_blank" rel="noreferrer noopener"
                    aria-label={`Open the shop for ${reseller.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-subtle hover:text-content-primary"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
                <p className="mt-1.5 text-micro text-content-secondary">
                  {reseller.customDomain && reseller.customDomainSeenAt
                    ? 'Their own domain, so this one is public. The token link still works.'
                    : reseller.customDomain
                      ? `Waiting for ${reseller.customDomain} to start answering. Until then this is the link.`
                      : 'Anyone holding this link can see it. Reissue to revoke it.'}
                </p>
              </div>

              {canManage && (
                <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-line-subtle px-6 py-3.5">
                  <Button variant="ghost" onClick={() => setEditing(reseller)} icon={<Pencil className="h-3.5 w-3.5" />}>
                    Branding
                  </Button>
                  <LogoButton reseller={reseller} onDone={(m) => toast.success(m)} onFail={(m) => toast.error('Could not save that logo', m)} />
                  <Button variant="ghost" onClick={() => setReaching(reseller)} icon={<Globe className="h-3.5 w-3.5" />}>
                    Domain &amp; embed
                  </Button>
                  <Button variant="ghost" onClick={() => setRotating(reseller)} icon={<RefreshCw className="h-3.5 w-3.5" />}>
                    Reissue link
                  </Button>
                  <button
                    type="button" onClick={() => setDeleting(reseller)} aria-label={`Remove ${reseller.name}`}
                    className="ml-auto flex h-8 w-8 items-center justify-center rounded-sm text-content-secondary hover:bg-state-danger/10 hover:text-state-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <ResellerFormModal
        open={create.open || editing !== null}
        reseller={editing}
        onClose={() => { create.close(); setEditing(null) }}
        onSaved={(message) => { toast.success(message); create.close(); setEditing(null) }}
      />

      {reaching && (
        <ResellerReach
          reseller={reaching}
          origin={origin}
          canManage={canManage}
          onClose={() => setReaching(null)}
        />
      )}

      <ConfirmDialog
        open={rotating !== null}
        onCancel={() => setRotating(null)}
        onConfirm={confirmRotate}
        loading={busy}
        title={`Reissue the link for ${rotating?.name}?`}
        message="The link they are using now will stop working immediately, and anyone it was forwarded to loses access. You will need to send them the new one."
        confirmLabel="Reissue the link"
      />

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={busy}
        title={`Remove ${deleting?.name}?`}
        message="Their shop link stops working immediately. Switch them off instead if this is temporary."
        confirmLabel="Remove reseller"
      />
    </>
  )
}

/** Logo upload, as its own small form so it can post a file. */
function LogoButton({ reseller, onDone, onFail }: {
  reseller: ResellerRow
  onDone: (message: string) => void
  onFail: (message?: string) => void
}) {
  const [state, action] = useFormState(uploadResellerLogoAction, INITIAL)
  const [seen, setSeen] = useState(false)

  if (state.ok && !seen) { setSeen(true); onDone(state.message ?? 'Logo updated.') }
  if (!state.ok && state.message && !seen) { setSeen(true); onFail(state.message) }

  return (
    <form action={action} className="contents">
      <input type="hidden" name="id" value={reseller.id} />
      <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-sm px-2.5 text-small font-bold text-content-secondary hover:bg-surface-subtle hover:text-content-primary">
        <Upload className="h-3.5 w-3.5" />
        {reseller.hasLogo ? 'Replace logo' : 'Add logo'}
        <input
          type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="sr-only"
          onChange={(event) => { setSeen(false); event.currentTarget.form?.requestSubmit() }}
        />
      </label>
      {reseller.hasLogo && (
        <Button
          type="button"
          variant="ghost"
          onClick={async () => {
            const result = await removeResellerLogoAction(reseller.id)
            if (result.ok) onDone('Logo removed.')
            else onFail(result.message)
          }}
        >
          Remove
        </Button>
      )}
    </form>
  )
}

/**
 * The save, with the failure the form could not previously report.
 *
 * `useFormState` surfaces what an action returns; it cannot surface an action
 * that never ran. The commonest reason for that is a deployment landing while
 * the page is open — server actions are tied to a build id, so the request is
 * refused before any of our code executes and the form simply sits there.
 * Catching it here turns the one failure that looked like a broken button into
 * a sentence saying what to do about it.
 */
async function submitReseller(previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    return await saveResellerAction(previous, formData)
  } catch {
    return {
      ok: false,
      message: 'Could not reach the server. This usually means the application was updated while this tab was open — reload the page and try again.',
    }
  }
}

function ResellerFormModal({ open, reseller, onClose, onSaved }: {
  open: boolean
  reseller: ResellerRow | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [state, action] = useFormState(submitReseller, INITIAL)
  const [wasOpen, setWasOpen] = useState(false)
  const navLinks = parseNavLinks(reseller?.navLinks ?? null)

  if (state.ok && open && !wasOpen) {
    setWasOpen(true)
    onSaved(state.message ?? 'Saved')
  }
  if (!open && wasOpen) setWasOpen(false)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reseller ? `Edit ${reseller.name}` : 'Add a reseller'}
      description="How their shop window is branded, and who their customers should contact."
      footer={<FormFooter onClose={onClose} isEdit={Boolean(reseller)} formId="reseller-form" />}
    >
      <form id="reseller-form" action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
        {reseller && <input type="hidden" name="id" value={reseller.id} />}
        <FormProblems state={state} />
        <TextField name="name" label="Reseller name" required className="sm:col-span-2"
          defaultValue={reseller?.name ?? ''} error={state.errors?.name}
          hint="What you call them internally." placeholder="e.g. Gulf Timepieces" />
        <TextField name="displayName" label="Shown on their page" className="sm:col-span-2"
          defaultValue={reseller?.displayName ?? ''} hint="Leave blank to use the name above." />
        <TextField name="headline" label="Headline" className="sm:col-span-2"
          defaultValue={reseller?.headline ?? ''} placeholder="e.g. Available now" />
        <TextareaField name="intro" label="Introduction" className="sm:col-span-2"
          defaultValue={reseller?.intro ?? ''}
          placeholder="A line or two their customers read at the top of the page." />

        <TextField name="brandColor" label="Brand colour" type="color"
          defaultValue={reseller?.brandColor ?? '#04173A'} error={state.errors?.brandColor}
          hint="The banner behind their logo." />
        <TextField name="accentColor" label="Accent colour" type="color"
          defaultValue={reseller?.accentColor ?? '#0F766E'} error={state.errors?.accentColor}
          hint="Brand names, links and prices." />

        <SelectField name="displayCurrency" label="Quote prices in"
          defaultValue={reseller?.displayCurrency ?? 'USD'}
          options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <TextField name="contactName" label="Contact" defaultValue={reseller?.contactName ?? ''} />
        <TextField name="contactEmail" label="Contact email" type="email"
          defaultValue={reseller?.contactEmail ?? ''} error={state.errors?.contactEmail} />
        <TextField name="contactPhone" label="Contact phone" defaultValue={reseller?.contactPhone ?? ''} />
        <TextField name="website" label="Their website" className="sm:col-span-2"
          defaultValue={reseller?.website ?? ''} placeholder="example.com"
          error={state.errors?.website}
          hint="Where their logo and the “Visit our site” button send customers." />
        <fieldset className="sm:col-span-2">
          <legend className="text-small font-bold text-content-primary">Their navigation</legend>
          <p className="mt-0.5 text-caption text-content-secondary">
            Links back to their own website, shown along the top of their shop. Leave a row blank to skip it.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((index) => {
              const link = navLinks[index]
              return (
                <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <input
                    name={`navLabel${index}`}
                    defaultValue={link?.label ?? ''}
                    placeholder={index === 0 ? 'Home' : 'Label'}
                    maxLength={40}
                    className="h-10 rounded-sm border border-line-subtle bg-surface-raised px-3 text-small text-content-primary placeholder:text-content-muted"
                  />
                  <input
                    name={`navHref${index}`}
                    defaultValue={link?.href ?? ''}
                    placeholder="https://their-site.com"
                    maxLength={300}
                    className="h-10 rounded-sm border border-line-subtle bg-surface-raised px-3 font-mono text-caption text-content-primary placeholder:text-content-muted"
                  />
                </div>
              )
            })}
          </div>
          {state.errors?.navLinks && (
            <p className="mt-1.5 text-caption text-state-danger">{state.errors.navLinks}</p>
          )}
        </fieldset>

        <TextareaField name="notes" label="Internal notes" className="sm:col-span-2"
          defaultValue={reseller?.notes ?? ''} hint="Never shown on their page." />
        <div className="sm:col-span-2">
          <Checkbox name="isActive" label="Their shop link is live"
            hint="Switch off to take the page down without losing the record."
            defaultChecked={reseller?.isActive ?? true} />
        </div>
      </form>
    </Modal>
  )
}

/** Which errors already appear beside a field. */
const INLINE_ERRORS = new Set(['name', 'contactEmail', 'brandColor', 'accentColor'])

/**
 * Anything the form refused that no field is showing.
 *
 * A validation error keyed to something without a visible field — a nested
 * `navLinks.0.href`, or a field added later and not wired up — used to make
 * the form do nothing at all: no message, dialog open, button apparently
 * broken. A submission that is refused has to say so somewhere, and this is
 * the somewhere, whatever the key turns out to be.
 */
function FormProblems({ state }: { state: ActionState }) {
  const errors = state.errors ?? {}
  const unshown = Object.entries(errors).filter(([key]) => !INLINE_ERRORS.has(key))
  if (unshown.length === 0 && !state.message) return null

  const label = (key: string) => {
    const nav = key.match(/^navLinks\.(\d+)\./)
    if (nav) return `Link ${Number(nav[1]) + 1}`
    if (key === '_form' || key === 'navLinks') return null
    return key
  }

  return (
    <div
      role="alert"
      className="sm:col-span-2 rounded-sm border border-state-danger/30 bg-state-danger/5 px-3.5 py-3 text-caption text-state-danger"
    >
      {state.message && <p className="font-bold">{state.message}</p>}
      {unshown.map(([key, message]) => {
        const name = label(key)
        return <p key={key}>{name ? `${name}: ${message}` : message}</p>
      })}
    </div>
  )
}

function FormFooter({ onClose, isEdit, formId }: { onClose: () => void; isEdit: boolean; formId: string }) {
  const { pending } = useFormStatus()
  // The modal renders its footer beside the form rather than inside it, so
  // this button is not a descendant of the form it submits. Asking the form to
  // submit itself is the same code path as a button inside it, without
  // depending on the `form` attribute being honoured from out here.
  const submit = () => {
    const form = document.getElementById(formId)
    if (form instanceof HTMLFormElement) form.requestSubmit()
  }
  return (
    <>
      <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
      <Button type="button" onClick={submit} loading={pending}>
        {isEdit ? 'Save changes' : 'Add reseller'}
      </Button>
    </>
  )
}
