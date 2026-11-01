'use client'
import { useState } from 'react'
import { Check, Copy, ExternalLink, Link2, Plus, Trash2 } from 'lucide-react'
import { Button, Card, Checkbox, ConfirmDialog, TextField, Chip, useToast } from '@/components/ui'
import { createCatalogueLinkAction, revokeCatalogueLinkAction } from '@/app/actions/catalogue-links'

/**
 * The links we hand the trade, and the controls for them.
 *
 * Alex: "Create a catalogue link that shows all the watches except in
 * transit & hong kong to show traders what we have with filtering and no
 * pricing."
 *
 * On the resellers page rather than on /catalogue, which is where it
 * started: /catalogue belongs to the trade partner's own role and
 * `catalogue:read` is a capability only TRADER holds, so the page that
 * looked like the obvious home is the one page nobody who can issue a link
 * is allowed to open. This page is already the answer to "who outside the
 * business can see our stock", and is behind the same capability.
 *
 * Several links rather than one standing URL, each named. One URL cannot be
 * withdrawn from a dealer who has fallen out with us without being withdrawn
 * from every dealer at once, and a token with no name against it cannot
 * answer the only question ever asked of this screen — which link do we kill.
 */

export interface CatalogueLinkView {
  id: string
  label: string
  token: string
  isActive: boolean
  showTradePhotos: boolean
  /** ISO, because a Date cannot cross into a client component. */
  lastViewedAt: string | null
  viewCount: number
  createdAt: string
}

export function CatalogueLinkPanel({ links, origin, stockCount }: {
  links: CatalogueLinkView[]
  origin: string
  /** How many watches a link would show right now. */
  stockCount: number
}) {
  const toast = useToast()
  // Closed by default. Most visits to this page are not about the links, and
  // a panel of tokens open above the stock is in the way of the stock.
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [tradePhotos, setTradePhotos] = useState(false)
  const [busy, setBusy] = useState(false)
  const [killing, setKilling] = useState<CatalogueLinkView | null>(null)

  const live = links.filter((link) => link.isActive)

  const create = async () => {
    setBusy(true)
    const result = await createCatalogueLinkAction(label.trim(), tradePhotos)
    setBusy(false)
    if (!result.ok) { toast.error('Not created', result.message); return }
    setLabel('')
    setTradePhotos(false)
    toast.success('Link ready', result.message)
  }

  const revoke = async () => {
    if (!killing) return
    setBusy(true)
    const result = await revokeCatalogueLinkAction(killing.id)
    setBusy(false)
    setKilling(null)
    if (!result.ok) { toast.error('Not revoked', result.message); return }
    toast.success('Link revoked', result.message)
  }

  return (
    <Card className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((on) => !on)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <Link2 className="h-4 w-4 shrink-0 text-content-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-small font-bold text-content-primary">Trade catalogue links</span>
          <span className="block text-caption text-content-secondary">
            {live.length === 0
              ? 'Send a dealer the list — every piece, no prices, nothing about where it came from.'
              : `${live.length} live ${live.length === 1 ? 'link' : 'links'} · ${stockCount} ${stockCount === 1 ? 'piece' : 'pieces'} on the list right now`}
          </span>
        </span>
        <span className="shrink-0 text-caption text-content-secondary">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="border-t border-line-subtle px-4 py-4">
          <p className="text-caption leading-relaxed text-content-secondary">
            A link opens a filterable list of everything we hold, with no price anywhere on it and
            nothing about cost, supplier or location. Stock in transit is off it, and so is anywhere
            switched off under{' '}
            <a href="/locations" className="underline underline-offset-2 hover:text-content-primary">
              Locations
            </a>
            {' '}— which is how Hong Kong stays off it.
          </p>
          {/*
            Said plainly, because it is the one thing somebody should know
            before pasting this into a group chat. The URL is the whole of
            the access control: there is no passphrase, exactly as there is
            none on a reseller's shop window.
          */}
          <p className="mt-2 text-caption leading-relaxed text-content-secondary">
            Anybody holding the link can open it — there is no passphrase. Revoke a link and it dies
            immediately for everyone who has it.
          </p>

          {live.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {live.map((link) => (
                <LinkRow
                  key={link.id}
                  link={link}
                  origin={origin}
                  onRevoke={() => setKilling(link)}
                  onCopyFailed={() => toast.error('Could not copy', 'Select the link and copy it by hand.')}
                />
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line-subtle pt-4">
            <TextField
              name="label"
              label="New link for"
              placeholder="e.g. Dubai dealers"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="min-w-[14rem] flex-1"
            />
            <Button onClick={create} loading={busy} disabled={!label.trim()}>
              <Plus className="h-4 w-4" aria-hidden />
              Create link
            </Button>
          </div>
          {/*
            Off by default. A trade shot is a record picture, taken on
            whatever surface was to hand and often with the papers in frame,
            and a link with no passphrase on it may be forwarded anywhere.
            The switch is applied in the query, so a link without it is never
            even sent the photograph ids.
          */}
          <div className="mt-3">
            <Checkbox
              name="showTradePhotos"
              label="Include trade photographs on this link"
              hint="The desk shots, behind a tap. Off by default — they often have the papers in frame, and a link with no passphrase can be forwarded."
              checked={tradePhotos}
              onChange={(event) => setTradePhotos(event.target.checked)}
            />
          </div>

          {links.length > live.length && (
            <p className="mt-4 border-t border-line-subtle pt-3 text-caption text-content-muted">
              {links.length - live.length} revoked {links.length - live.length === 1 ? 'link' : 'links'} kept
              on record. Those URLs open nothing.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(killing)}
        onCancel={() => setKilling(null)}
        onConfirm={revoke}
        title={`Revoke "${killing?.label ?? ''}"?`}
        message="Anybody holding this link stops being able to open it, straight away. It cannot be switched back on — issue a new one instead."
        confirmLabel="Revoke it"
        tone="danger"
        loading={busy}
      />
    </Card>
  )
}

function LinkRow({ link, origin, onRevoke, onCopyFailed }: {
  link: CatalogueLinkView
  origin: string
  onRevoke: () => void
  onCopyFailed: () => void
}) {
  const [copied, setCopied] = useState(false)
  const url = `${origin}/c/${link.token}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      onCopyFailed()
    }
  }

  return (
    <li className="rounded-md bg-surface-subtle px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-caption font-semibold text-content-primary">
            {link.label}
          </span>
          <code className="block truncate font-mono text-micro text-content-secondary">{url}</code>
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy the link for ${link.label}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-raised hover:text-content-primary"
        >
          {copied
            ? <Check className="h-4 w-4 text-state-success" aria-hidden />
            : <Copy className="h-4 w-4" aria-hidden />}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open the link for ${link.label}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-raised hover:text-content-primary"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
        <button
          type="button"
          onClick={onRevoke}
          aria-label={`Revoke the link for ${link.label}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-raised hover:text-state-danger"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {/* Proof of life. A link nobody has opened is one worth withdrawing,
          and "never opened" is the most useful thing this row can say. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {link.showTradePhotos && <Chip tone="neutral">Trade photos</Chip>}
        <span className="text-micro text-content-muted">
          {link.viewCount === 0
            ? 'Never opened'
            : `Opened ${link.viewCount} ${link.viewCount === 1 ? 'time' : 'times'}${
              link.lastViewedAt ? ` · last ${new Date(link.lastViewedAt).toLocaleDateString()}` : ''
            }`}
        </span>
      </div>
    </li>
  )
}
