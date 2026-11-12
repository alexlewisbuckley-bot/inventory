'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Globe, Trash2, Wand2 } from 'lucide-react'
import { Button, Card, TextField, useToast } from '@/components/ui'
import {
  proposeBrandAction, savePartnerBrandAction,
  uploadPartnerLogoAction, removePartnerLogoAction,
} from '@/app/actions/partners'
import type { ActionState } from '@/app/actions/auth'

const INITIAL: ActionState = { ok: false }

interface Proposal {
  sourceUrl: string
  brandColor: string | null
  accentColor: string | null
  logo: { mimeType: string; dataUrl: string } | null
  notes: string[]
}

/**
 * How a partner's portal looks.
 *
 * Alex: "add a way to brand the sites with logo colours etc from partner
 * companies, posting their URL and having claude skin it would be ideal."
 *
 * The colours existed and were never editable — the form carried them as
 * hidden fields at our own navy and teal, so every partner portal looked like
 * our software rather than theirs. Now: paste their address, see what their
 * own site says about them, and accept it or change it.
 *
 * Nothing applies itself. A proposal is shown as a proposal, because the
 * failure to avoid is an estate agency's staff opening their portal to find
 * it quietly the wrong colour, and "a parser liked a stylesheet" is not a
 * reason anybody would accept for that.
 */
export function PartnerBrand({ partner }: {
  partner: {
    id: string
    name: string
    website: string | null
    brandColor: string
    accentColor: string
    hasLogo: boolean
    brandSourceUrl: string | null
    brandTakenAt: string | null
  }
}) {
  const toast = useToast()
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [brandColor, setBrandColor] = useState(partner.brandColor)
  const [accentColor, setAccentColor] = useState(partner.accentColor)
  const [busy, setBusy] = useState(false)

  const [lookState, look] = useFormState(proposeBrandAction, INITIAL)
  const [saveState, save] = useFormState(savePartnerBrandAction, INITIAL)
  const [uploadState, upload] = useFormState(uploadPartnerLogoAction, INITIAL)

  // A saved proposal is done with: leaving the panel up invites somebody to
  // press "Use this" twice and wonder which one took.
  if (saveState.ok && proposal) setProposal(null)

  // The action hands the proposal back as JSON in its message: a server action
  // returns one shape, and inventing a second for this alone would be a type
  // nobody else uses.
  if (lookState.ok && lookState.message && (!proposal || proposal.sourceUrl !== JSON.parse(lookState.message).sourceUrl)) {
    const next = JSON.parse(lookState.message) as Proposal
    setProposal(next)
    if (next.brandColor) setBrandColor(next.brandColor)
    if (next.accentColor) setAccentColor(next.accentColor)
  }

  const dropLogo = async () => {
    setBusy(true)
    const result = await removePartnerLogoAction(partner.id)
    setBusy(false)
    if (result.ok) toast.success('Logo removed')
    else toast.error('Could not remove that logo', result.message)
  }

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line-subtle px-5 py-4">
        <Wand2 className="h-4 w-4 text-content-secondary" aria-hidden />
        <p className="text-body font-bold text-content-primary">How their portal looks</p>
        {partner.brandSourceUrl && partner.brandTakenAt && (
          /* Where it came from, so a portal that has gone a year out of date
             is something somebody can see rather than something nobody knows. */
          <p className="ml-auto text-caption text-content-secondary">
            Taken from {partner.brandSourceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            {' · '}
            {new Date(partner.brandTakenAt).toLocaleDateString('en-GB')}
          </p>
        )}
      </div>

      <div className="space-y-5 px-5 py-4">
        <form action={look} className="flex flex-wrap items-end gap-3">
          <TextField
            name="url"
            label="Their website"
            defaultValue={partner.website ?? partner.brandSourceUrl ?? ''}
            placeholder="theircompany.com"
            className="min-w-[260px] flex-1"
            hint="We read their logo and colours off their own site. Nothing changes until you say so."
          />
          <LookButton />
        </form>

        {lookState.message && !lookState.ok && (
          <p role="alert" className="text-small text-state-danger">{lookState.message}</p>
        )}
        {saveState.message && !saveState.ok && (
          <p role="alert" className="text-small text-state-danger">{saveState.message}</p>
        )}
        {uploadState.message && !uploadState.ok && (
          <p role="alert" className="text-small text-state-danger">{uploadState.message}</p>
        )}

        {/*
          * The colours are always editable, proposal or not.
          *
          * They were only reachable after a successful read to begin with,
          * which left no way to nudge a colour by hand — and the first thing
          * anybody does with a guessed palette is nudge it.
          */}
        <form action={save} className="space-y-4 rounded-md border border-line-subtle p-4">
          <input type="hidden" name="id" value={partner.id} />
          {proposal && <input type="hidden" name="sourceUrl" value={proposal.sourceUrl} />}
          {proposal?.logo && (
            <input type="hidden" name="logoDataUrl" value={proposal.logo.dataUrl} />
          )}

          <p className="text-caption font-semibold uppercase tracking-wide text-content-secondary">
            {proposal ? 'What their site says' : 'Their colours'}
          </p>

          <div className="flex flex-wrap items-center gap-5">
            {proposal?.logo && (
              <div className="flex h-16 w-32 items-center justify-center rounded-md bg-surface-subtle p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={proposal.logo.dataUrl} alt="" className="max-h-full max-w-full object-contain" />
              </div>
            )}

            <Swatch label="Main" value={brandColor} onChange={setBrandColor} name="brandColor" />
            <Swatch label="Accent" value={accentColor} onChange={setAccentColor} name="accentColor" />

            {/* Their colours against their words, at the size they will
                actually appear, because two hex codes side by side tell
                nobody whether the result is readable. */}
            <div
              className="flex min-w-[170px] flex-1 items-center gap-3 rounded-md px-4 py-3"
              style={{ backgroundColor: brandColor }}
            >
              <span className="font-serif text-[17px] text-white">{partner.name}</span>
              <span className="ml-auto h-3 w-3 rounded-full" style={{ backgroundColor: accentColor }} />
            </div>
          </div>

          {proposal && proposal.notes.length > 0 && (
            <ul className="space-y-0.5">
              {proposal.notes.map((note) => (
                <li key={note} className="text-caption text-content-secondary">{note}</li>
              ))}
            </ul>
          )}

          <div className="flex gap-2.5">
            <SaveBrand proposed={proposal !== null} />
            {proposal && (
              <Button type="button" variant="ghost" onClick={() => setProposal(null)}>
                Leave it as it is
              </Button>
            )}
          </div>
        </form>

        {/* The way in when a site gives nothing useful, which is common for a
            company whose web presence is one page a cousin built. */}
        <div className="flex flex-wrap items-end gap-4 border-t border-line-subtle pt-4">
          <form action={upload} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={partner.id} />
            <label className="block">
              <span className="mb-1 block text-caption font-semibold text-content-secondary">
                Or upload their logo
              </span>
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="text-small text-content-secondary file:mr-3 file:rounded-md file:border file:border-line-subtle file:bg-surface-raised file:px-3 file:py-1.5 file:text-small file:text-content-primary"
              />
            </label>
            <UploadButton />
          </form>

          {partner.hasLogo && (
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-24 items-center justify-center rounded-md bg-surface-subtle p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/partner-logo/${partner.id}`} alt="" className="max-h-full max-w-full object-contain" />
              </div>
              <button
                type="button"
                onClick={() => void dropLogo()}
                disabled={busy}
                aria-label="Remove the logo"
                className="rounded p-1.5 text-content-muted hover:bg-surface-subtle hover:text-state-danger"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

/** A colour, as a swatch you can click and as the hex somebody can paste. */
function Swatch({ label, value, onChange, name }: {
  label: string
  value: string
  onChange: (value: string) => void
  name: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-caption font-semibold text-content-secondary">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} colour`}
          className="h-9 w-9 cursor-pointer rounded border border-line-subtle bg-transparent p-0.5"
        />
        <input
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-[92px] rounded-md border border-line-subtle bg-surface-raised px-2 font-mono text-caption text-content-primary"
        />
      </span>
    </label>
  )
}

function LookButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="secondary" loading={pending} icon={<Globe className="h-4 w-4" />}>
      {pending ? 'Reading their site…' : 'Read their branding'}
    </Button>
  )
}

function SaveBrand({ proposed }: { proposed: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      {proposed ? 'Use this' : 'Save colours'}
    </Button>
  )
}

function UploadButton() {
  const { pending } = useFormStatus()
  return <Button type="submit" size="sm" variant="secondary" loading={pending}>Upload</Button>
}
