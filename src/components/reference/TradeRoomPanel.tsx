'use client'
import { useState } from 'react'
import { Check, Copy, ExternalLink, Handshake, KeyRound, RefreshCw } from 'lucide-react'
import { Button, ConfirmDialog, TextField, useToast } from '@/components/ui'
import {
  closeTradeRoomAction, rotateTradeTokenAction, setTradeAccessAction,
} from '@/app/actions/resellers'

/**
 * The trade room's controls.
 *
 * A second door into the same stock, for a different audience. The shop
 * window shows a reseller's customers the catalogue photograph and the retail
 * price; this shows a dealer the photograph of the actual watch and no price
 * at all, because the number they pay is the one agreed on the phone and a
 * figure on the screen has already made the first offer.
 *
 * Two things make a room: a link and a passphrase. They are set together and
 * cleared together, because either on its own is a thing that reads as
 * working and is not — a passphrase guarding nothing, or a live-looking URL
 * that opens nothing and that somebody will take as access still being there.
 *
 * The passphrase is shown once, here, as the person types it, and never
 * again. There is no "reveal" because there is nothing to reveal: it is
 * hashed on the way in. Losing it costs a new one, not a recovery, and saying
 * that on the screen is what stops somebody relying on being able to look it
 * up in a fortnight.
 */
export function TradeRoomPanel({ reseller, origin, canManage }: {
  reseller: { id: string; name: string; tradeToken: string | null }
  origin: string
  canManage: boolean
}) {
  const toast = useToast()
  const [token, setToken] = useState(reseller.tradeToken)
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState<'set' | 'rotate' | 'close' | null>(null)
  const [copied, setCopied] = useState(false)
  const [closing, setClosing] = useState(false)
  const [justSet, setJustSet] = useState<string | null>(null)

  const link = token ? `${origin}/t/${token}` : null

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy', 'Select the link and copy it by hand.')
    }
  }

  const save = async () => {
    setBusy('set')
    const result = await setTradeAccessAction(reseller.id, passphrase)
    setBusy(null)
    if (!result.ok) { toast.error('Not saved', result.message); return }
    setToken(result.token ?? token)
    // Held on screen until they navigate away, because this is the only
    // moment it exists in a readable form anywhere.
    setJustSet(passphrase)
    setPassphrase('')
    toast.success('Trade room ready', result.message)
  }

  const rotate = async () => {
    setBusy('rotate')
    const result = await rotateTradeTokenAction(reseller.id)
    setBusy(null)
    if (!result.ok) { toast.error('Not reissued', result.message); return }
    setToken(result.token ?? null)
    toast.success('New link issued', result.message)
  }

  const close = async () => {
    setClosing(false)
    setBusy('close')
    const result = await closeTradeRoomAction(reseller.id)
    setBusy(null)
    if (!result.ok) { toast.error('Not closed', result.message); return }
    setToken(null)
    setJustSet(null)
    toast.success('Trade room closed', result.message)
  }

  return (
    <section>
      <h3 className="flex items-center gap-2 text-small font-bold text-content-primary">
        <Handshake className="h-4 w-4 text-content-accent" aria-hidden />
        Trade room
      </h3>
      <p className="mt-1 text-caption text-content-secondary">
        The same stock behind a passphrase, shown as trade photographs with no prices —
        for dealers rather than their customers. Only watches that have a trade shot appear.
      </p>

      {link && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-surface-subtle px-3.5 py-2.5">
          <code className="min-w-0 flex-1 truncate font-mono text-caption text-content-primary">
            {link}
          </code>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy the trade link"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-raised hover:text-content-primary"
          >
            {copied
              ? <Check className="h-4 w-4 text-state-success" aria-hidden />
              : <Copy className="h-4 w-4" aria-hidden />}
          </button>
          <a
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open the trade link"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-content-secondary hover:bg-surface-raised hover:text-content-primary"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </div>
      )}

      {justSet && (
        <div className="mt-2.5 rounded-md border border-state-warning/40 bg-state-warning/5 px-3.5 py-2.5">
          <p className="text-caption text-content-secondary">
            <span className="font-semibold text-content-primary">Passphrase: </span>
            <code className="font-mono text-content-primary">{justSet}</code>
          </p>
          <p className="mt-1 text-caption text-content-secondary">
            Send it to {reseller.name} now. It is stored hashed and cannot be shown again —
            if it is lost, set a new one.
          </p>
        </div>
      )}

      {canManage && (
        <div className="mt-3 flex items-end gap-2">
          <TextField
            label={token ? 'Change the passphrase' : 'Passphrase'}
            className="flex-1"
            type="password"
            autoComplete="off"
            placeholder="At least 12 characters"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            disabled={busy !== null}
            hint={token
              ? 'Changing it signs out everybody who is already in.'
              : 'Dictated down a phone more often than typed, so length matters more than symbols.'}
          />
          <Button
            className="mb-0.5"
            icon={<KeyRound className="h-4 w-4" />}
            onClick={save}
            loading={busy === 'set'}
            disabled={passphrase.trim().length < 12 || busy !== null}
          >
            {token ? 'Change' : 'Open'}
          </Button>
        </div>
      )}

      {canManage && token && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={rotate}
            loading={busy === 'rotate'}
            disabled={busy !== null}
          >
            New link
          </Button>
          <button
            type="button"
            onClick={() => setClosing(true)}
            disabled={busy !== null}
            className="text-caption text-content-secondary underline underline-offset-2 hover:text-state-danger"
          >
            Close the trade room
          </button>
          <span className="ml-auto text-caption text-content-muted">
            A new link keeps the passphrase — use it when the URL has gone somewhere it should not.
          </span>
        </div>
      )}

      <ConfirmDialog
        open={closing}
        onCancel={() => setClosing(false)}
        onConfirm={close}
        tone="danger"
        title={`Close ${reseller.name}'s trade room?`}
        message="The link stops working immediately and the passphrase is forgotten. Opening it again means a new link and a new passphrase."
        confirmLabel="Close it"
      />
    </section>
  )
}
