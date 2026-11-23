'use client'
import { useState, useTransition } from 'react'
import { Plus, Trash2, Wallet } from 'lucide-react'
import {
  removeWalletAction, saveExplorerKeyAction, saveWalletAction, scanWalletsAction,
} from '@/app/actions/wallets'
import { Button, Card, Chip, SelectField, TextField, useToast } from '@/components/ui'
import { shortAddress } from '@/lib/usdt'
import { WALLET_CHAINS, WALLET_CHAIN_LABELS, type WalletChain } from '@/lib/enums'

export interface WalletRow {
  id: string
  label: string
  chain: WalletChain
  address: string
  isActive: boolean
  transfers: number
  lastSeen: string | null
}

export interface KeyRow {
  chain: WalletChain
  source: 'stored' | 'environment' | 'none'
  hint: string | null
  required: boolean
}

/**
 * The wallets we watch, and the keys that let us read them.
 *
 * Worth being plain about what is here, because "wallet" and "key" in one
 * screen usually means something far more dangerous: these are addresses,
 * which are public, and read-only explorer keys, which raise a rate limit.
 * Nothing on this page can move a dollar, and nothing in the system holds a
 * private key. The screen says so, where somebody is deciding whether to
 * paste something into it.
 */
export function WalletManager({ wallets, keys }: { wallets: WalletRow[]; keys: KeyRow[] }) {
  const toast = useToast()
  const [pending, start] = useTransition()
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [chain, setChain] = useState<string>('TRON')
  const [address, setAddress] = useState('')
  const [watchFrom, setWatchFrom] = useState('')

  const run = (work: () => Promise<{ ok: boolean; message: string; detail?: string }>) => {
    start(async () => {
      const result = await work()
      if (result.ok) toast.success(result.message, result.detail)
      else toast.error(result.message, result.detail)
    })
  }

  const add = () => {
    run(async () => {
      const result = await saveWalletAction({ label, chain, address, watchFrom: watchFrom || null })
      if (result.ok) {
        setLabel('')
        setAddress('')
        setWatchFrom('')
        setAdding(false)
      }
      return result
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-5 py-4">
          <div>
            <h2 className="text-small font-bold text-content-primary">Wallets we watch</h2>
            <p className="text-caption text-content-secondary">
              Addresses only. Nothing here can move money — an address is public, and reading it
              is all this does.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setAdding((open) => !open)}
          >
            Add a wallet
          </Button>
        </div>

        {adding && (
          <div className="grid gap-3 border-b border-line-subtle bg-surface-subtle px-5 py-4 sm:grid-cols-2">
            <TextField
              name="label"
              label="What we call it"
              placeholder="Main TRON wallet"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
            <SelectField
              name="chain"
              label="Chain"
              value={chain}
              onChange={(event) => setChain(event.target.value)}
              options={WALLET_CHAINS.map((code) => ({ value: code, label: WALLET_CHAIN_LABELS[code] }))}
            />
            <TextField
              name="address"
              label="Address"
              placeholder={chain === 'TRON' ? 'T…' : '0x…'}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
            {/*
              Without this, the first scan of a wallet three years old pulls
              its whole life — thousands of transfers, none of them this
              year's invoices.
            */}
            <TextField
              name="watchFrom"
              label="Read from"
              type="date"
              hint="Leave blank to read everything the explorer will give."
              value={watchFrom}
              onChange={(event) => setWatchFrom(event.target.value)}
            />
            <div className="sm:col-span-2">
              <Button type="button" size="sm" disabled={pending} onClick={add}>Save the wallet</Button>
            </div>
          </div>
        )}

        {wallets.length === 0 ? (
          <p className="px-5 py-6 text-small text-content-secondary">
            No wallets yet. Add the address you are paid into and scan it.
          </p>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {wallets.map((wallet) => (
              <li key={wallet.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <Wallet className="h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
                <span className="font-bold text-content-primary">{wallet.label}</span>
                <Chip tone="neutral">{WALLET_CHAIN_LABELS[wallet.chain]}</Chip>
                <code className="text-caption text-content-secondary">{shortAddress(wallet.address)}</code>
                <span className="text-caption text-content-secondary">
                  {wallet.transfers} {wallet.transfers === 1 ? 'transfer' : 'transfers'}
                  {wallet.lastSeen ? ` · newest ${String(wallet.lastSeen).slice(0, 10)}` : ' · never scanned'}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => run(() => scanWalletsAction(wallet.id))}
                  >
                    Scan this one
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => run(() => removeWalletAction(wallet.id))}
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-line-subtle px-5 py-4">
          <h2 className="text-small font-bold text-content-primary">Explorer keys</h2>
          <p className="text-caption text-content-secondary">
            Read-only keys for the public block explorers. They raise a rate limit and can see
            nothing the chain does not already show the world. TRON works without one;
            Etherscan needs one.
          </p>
        </div>
        <ul className="divide-y divide-line-subtle">
          {keys.map((key) => (
            <ExplorerKeyRow key={key.chain} row={key} busy={pending} onSave={(value) => run(
              () => saveExplorerKeyAction(key.chain, value),
            )} />
          ))}
        </ul>
      </Card>
    </div>
  )
}

function ExplorerKeyRow({ row, busy, onSave }: {
  row: KeyRow
  busy: boolean
  onSave: (value: string) => void
}) {
  const [value, setValue] = useState('')

  return (
    <li className="flex flex-wrap items-end gap-x-4 gap-y-2 px-5 py-3">
      <div className="min-w-[160px]">
        <p className="text-small font-bold text-content-primary">{WALLET_CHAIN_LABELS[row.chain]}</p>
        <p className="text-caption text-content-secondary">
          {row.source === 'none'
            ? row.required ? 'No key — this chain cannot be scanned' : 'No key — scanning is slower'
            : `Set ${row.source === 'stored' ? 'here' : 'on the deployment'} · ${row.hint}`}
        </p>
      </div>
      <div className="min-w-[220px] flex-1">
        <TextField
          name={`key-${row.chain}`}
          label="Key"
          type="password"
          placeholder={row.source === 'none' ? 'Paste the key' : 'Replace it'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      {/*
        One button, saying what it would do. Empty box and no key stored is
        not "Remove" — there is nothing to remove, and a button offering it
        is a button that does nothing.
      */}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy || (!value.trim() && row.source !== 'stored')}
        onClick={() => { onSave(value); setValue('') }}
      >
        {value.trim() ? 'Save' : 'Remove'}
      </Button>
    </li>
  )
}
