'use client'
import { useState, useTransition } from 'react'
import {
  AlertTriangle, ArrowRight, Check, Eye, Info, Link2, RefreshCw, Sparkles, X,
} from 'lucide-react'
import {
  approveLinkAction, askClaudeAction, ignoreTransferAction, scanWalletsAction, unlinkAction,
} from '@/app/actions/wallets'
import { Button, Card, Chip, ComboSelect, EmptyState, StatCard, useToast } from '@/components/ui'
import { formatUsdt, shortAddress } from '@/lib/usdt'
import { WALLET_CHAIN_LABELS, type WalletChain } from '@/lib/enums'
import { targetUsd, type Flag, type Payable, type Proposal } from '@/lib/wallet-match'

export interface BoardTransferView {
  id: string
  amountUsd: number
  linkedUsd: number
  at: string
  counterparty: string
  walletLabel: string
  chain: WalletChain
  txHash: string
  direction: 'IN' | 'OUT'
  ignoredAt: string | null
  ignoreReason: string | null
  links: Array<{
    id: string
    kind: 'SALE' | 'COMMISSION'
    targetId: string
    reference: string
    customerName: string | null
    label: string | null
    at: string | null
    amountUsd: number
    basis: string
    confidence: number
    reason: string | null
    approvedAt: string | null
    approvedBy: string | null
  }>
}

/*
 * How the match was arrived at, said rather than abbreviated.
 * "rule" on a screen is a word somebody has to be told the meaning of; a
 * short clause is one they can read.
 */
const BASIS_WORDS: Record<string, string> = {
  RULE: 'matched on the figures',
  AI: 'suggested by Claude, approved here',
  HUMAN: 'chosen by hand',
}

const TONE_ICON = {
  alert: AlertTriangle,
  warn: AlertTriangle,
  info: Info,
} as const

const TONE_CLASS = {
  alert: 'border-state-danger/40 bg-state-danger/5',
  warn: 'border-state-warning/40 bg-state-warning/5',
  info: 'border-line-subtle bg-surface-subtle',
} as const

/**
 * What went wrong when the action itself did not come back.
 *
 * A server action can fail without ever returning a result: the function
 * times out part-way through a scan, a deployment restarts under it, the
 * connection drops. That rejects the promise, and a rejection inside a
 * transition is swallowed — the button stops spinning and nothing else
 * happens, which from the other side of the screen is indistinguishable
 * from a button that is not wired up. Saying so is the whole point.
 */
function mishap(error: unknown): { message: string; detail: string } {
  const text = error instanceof Error ? error.message : String(error ?? '')
  if (/fetch|network|load failed/i.test(text)) {
    return {
      message: 'That did not reach the server.',
      detail: 'The connection dropped part-way. Try it again.',
    }
  }
  return {
    message: 'The server did not finish that.',
    detail: text
      ? `${text} — if this was a scan, it may have been cut short part-way through.`
      : 'It may have been cut short part-way through. Try it again.',
  }
}

/** A redirect is the framework working, not a failure: let it through. */
function isRedirect(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest)
}

/**
 * What arrived, and what it paid for.
 *
 * Alex: "there should be a feature to scan the USDT wallet address and link
 * them to transactions accordingly and flag any other amounts missing or
 * things we should be aware of."
 *
 * Three things in that sentence, so three bands on the screen, in the order a
 * person wants them: what needs knowing, what needs placing, what is already
 * placed. The flags come first because they are the half of the job a
 * reconciliation tool usually skips — a tool that reports only its successes
 * leaves the unaccounted money exactly where it was.
 *
 * Nothing here writes until somebody presses a button. The proposals are
 * worked out fresh on every load rather than stored, because a stored guess
 * goes stale the moment an invoice is settled another way, and a screen
 * arguing for something that is no longer true is worse than no screen.
 */
export function PaymentsBoard({ transfers, payables, proposals, flags, totals }: {
  transfers: BoardTransferView[]
  payables: Payable[]
  proposals: Proposal[]
  flags: Flag[]
  totals: { unplacedUsd: number; waitingUsd: number; scanned: string | null }
}) {
  const toast = useToast()
  const [pending, start] = useTransition()
  const [aiProposals, setAiProposals] = useState<Proposal[]>([])
  const [notes, setNotes] = useState<string[]>([])

  const run = (work: () => Promise<{ ok: boolean; message: string; detail?: string }>) => {
    start(async () => {
      try {
        const result = await work()
        if (result.ok) toast.success(result.message, result.detail)
        else toast.error(result.message, result.detail)
      } catch (error) {
        if (isRedirect(error)) throw error
        const said = mishap(error)
        toast.error(said.message, said.detail)
      }
    })
  }

  const scan = () => run(() => scanWalletsAction(null))

  const ask = () => start(async () => {
    try {
      const result = await askClaudeAction()
      if (!result.ok) { toast.error(result.message); return }
      setAiProposals(result.proposals ?? [])
      setNotes(result.notes ?? [])
      toast.success(result.message, result.notes?.[0])
    } catch (error) {
      if (isRedirect(error)) throw error
      const said = mishap(error)
      toast.error(said.message, said.detail)
    }
  })

  const byPayment = new Map<string, Proposal[]>()
  for (const proposal of [...proposals, ...aiProposals]) {
    byPayment.set(proposal.paymentId, [...(byPayment.get(proposal.paymentId) ?? []), proposal])
  }

  const incoming = transfers.filter((transfer) => transfer.direction === 'IN')
  /*
   * What can be dealt with, first.
   *
   * The chain hands these over newest-first, which puts a one-dollar test
   * ping above a payment that is one press from settled. Proposals first,
   * then by size: that is the order somebody works down the list in.
   */
  const toPlace = incoming
    .filter((transfer) => !transfer.ignoredAt && transfer.linkedUsd < transfer.amountUsd)
    .sort((a, b) => {
      const proposed = Number(byPayment.has(b.id)) - Number(byPayment.has(a.id))
      return proposed !== 0 ? proposed : b.amountUsd - a.amountUsd
    })
  const placed = incoming.filter((transfer) => transfer.links.length > 0)
  const setAside = incoming.filter((transfer) => transfer.ignoredAt)
  const outgoing = transfers.filter((transfer) => transfer.direction === 'OUT')

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Not yet placed"
          value={formatUsdt(totals.unplacedUsd)}
          caption={`${toPlace.length} ${toPlace.length === 1 ? 'payment' : 'payments'} on the chain`}
        />
        <StatCard
          label="Invoices waiting"
          value={formatUsdt(totals.waitingUsd)}
          caption={`${payables.filter((payable) => !payable.settled).length} open`}
        />
        <StatCard
          label="Last scan"
          value={totals.scanned ?? 'Never'}
          caption={totals.scanned ? 'Scan again for anything since' : 'Add a wallet and scan it'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={scan} loading={pending} icon={<RefreshCw className="h-4 w-4" />}>
          Scan the wallets
        </Button>
        {/*
          A button rather than something that happens on every load: it costs
          money per press, and the rules have already done the certain work.
        */}
        <Button
          type="button"
          variant="secondary"
          onClick={ask}
          loading={pending}
          icon={<Sparkles className="h-4 w-4" />}
        >
          Ask Claude about the rest
        </Button>
      </div>

      {notes.length > 0 && (
        <Card className="border-line-subtle bg-surface-subtle px-5 py-4">
          <p className="text-caption font-bold uppercase tracking-[0.1em] text-content-secondary">
            What Claude noticed
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {notes.map((note) => (
              <li key={note} className="text-small text-content-primary">· {note}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* ------------------------------------------------ what to be aware of */}
      {flags.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-small font-bold text-content-primary">
            Worth knowing
            <span className="ml-2 font-normal text-content-secondary">{flags.length}</span>
          </h2>
          {flags.map((flag) => {
            const Icon = TONE_ICON[flag.tone]
            return (
              <div
                key={flag.id}
                className={`flex items-start gap-3 rounded-md border px-4 py-3 ${TONE_CLASS[flag.tone]}`}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-content-secondary" aria-hidden />
                <div>
                  <p className="text-small font-bold text-content-primary">{flag.headline}</p>
                  <p className="text-caption text-content-secondary">{flag.detail}</p>
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* --------------------------------------------------- what to place */}
      <section className="flex flex-col gap-2">
        <h2 className="text-small font-bold text-content-primary">Payments to place</h2>
        {toPlace.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing waiting"
              description="Every payment on the chain is against an invoice."
            />
          </Card>
        ) : (
          toPlace.map((transfer) => (
            <PaymentRow
              key={transfer.id}
              transfer={transfer}
              payables={payables}
              proposals={byPayment.get(transfer.id) ?? []}
              busy={pending}
              onApprove={(input) => run(() => approveLinkAction(input))}
              onIgnore={(reason) => run(() => ignoreTransferAction(transfer.id, reason))}
            />
          ))
        )}
      </section>

      {/* ------------------------------------------------ what is placed */}
      {placed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-small font-bold text-content-primary">
            Placed
            <span className="ml-2 font-normal text-content-secondary">{placed.length}</span>
          </h2>
          {/*
            The record of a decision, not a tick.
            Somebody checking a reconciliation needs three things in front of
            them: which payment, which deal, and on what grounds. The
            invoice number alone answers none of them — it names a row.
            So: the money as the chain recorded it, the deal in words
            anybody here would recognise, and the sentence the match was
            made on, kept exactly as it read when it was approved.
          */}
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line-subtle">
              {placed.map((transfer) => (
                <li key={transfer.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-bold tabular-nums text-content-primary">
                      {formatUsdt(transfer.amountUsd)}
                    </span>
                    <span className="text-caption text-content-secondary">
                      {transfer.at.slice(0, 10)} · from {shortAddress(transfer.counterparty)}
                      {' · '}{transfer.walletLabel} · {WALLET_CHAIN_LABELS[transfer.chain]}
                    </span>
                    <a
                      href={explorerLink(transfer.chain, transfer.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-caption text-content-secondary underline hover:text-content-primary"
                    >
                      on the chain
                    </a>
                    {transfer.linkedUsd < transfer.amountUsd && (
                      <Chip tone="gold">
                        {formatUsdt(transfer.amountUsd - transfer.linkedUsd)} still unplaced
                      </Chip>
                    )}
                  </div>

                  <ul className="mt-2 flex flex-col gap-2">
                    {transfer.links.map((link) => (
                      <li
                        key={link.id}
                        className="rounded-md border border-line-subtle bg-surface-subtle px-4 py-3"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <ArrowRight
                            className="h-3.5 w-3.5 shrink-0 text-content-secondary"
                            aria-hidden
                          />
                          <a
                            href={`/sales?q=${encodeURIComponent(link.reference)}`}
                            className="text-small font-bold text-content-primary underline decoration-line-subtle underline-offset-2 hover:decoration-current"
                          >
                            {link.reference}
                          </a>
                          <span className="text-small text-content-primary">
                            {[link.customerName, link.label].filter(Boolean).join(' · ')
                              || (link.kind === 'SALE' ? 'a sale' : 'a commission')}
                          </span>
                          <span className="ml-auto font-bold tabular-nums text-content-primary">
                            {formatUsdt(link.amountUsd)}
                          </span>
                        </div>

                        {/*
                          The reasoning, verbatim. A match approved on
                          "exactly what INV-0148 was waiting for" and one
                          approved on "the only invoice within 2% of this
                          figure" are different degrees of certain, and the
                          difference is only visible if the sentence is kept.
                        */}
                        {link.reason && (
                          <p className="mt-1.5 text-caption text-content-secondary">
                            Why: {link.reason}
                          </p>
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-content-secondary">
                          <span>{BASIS_WORDS[link.basis] ?? link.basis.toLowerCase()}</span>
                          {link.confidence > 0 && <span>· {link.confidence}% sure</span>}
                          {link.approvedBy && <span>· approved by {link.approvedBy}</span>}
                          {link.approvedAt && <span>· {link.approvedAt.slice(0, 10)}</span>}
                          {link.at && <span>· invoiced {link.at.slice(0, 10)}</span>}
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => run(() => unlinkAction(link.id))}
                            className="underline hover:text-content-primary"
                          >
                            unlink
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {(setAside.length > 0 || outgoing.length > 0) && (
        <section className="flex flex-col gap-2">
          <h2 className="text-small font-bold text-content-primary">Not for reconciling</h2>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line-subtle">
              {setAside.map((transfer) => (
                <li key={transfer.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                  <Chip tone="neutral">Set aside</Chip>
                  <span className="tabular-nums text-content-secondary">{formatUsdt(transfer.amountUsd)}</span>
                  <span className="text-caption text-content-secondary">{transfer.ignoreReason}</span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => ignoreTransferAction(transfer.id, '', true))}
                    className="text-caption text-content-secondary underline hover:text-content-primary"
                  >
                    put it back
                  </button>
                </li>
              ))}
              {outgoing.map((transfer) => (
                <li key={transfer.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                  <Chip tone="neutral">Out</Chip>
                  <span className="tabular-nums text-content-secondary">{formatUsdt(transfer.amountUsd)}</span>
                  <span className="text-caption text-content-secondary">
                    {transfer.at.slice(0, 10)} · to {shortAddress(transfer.counterparty)} · {transfer.walletLabel}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  )
}

/**
 * One payment, and what it might be for.
 *
 * The proposal is shown with its reasoning in the same breath as the figure,
 * because "92%" on its own is a number somebody either trusts or does not.
 * "40,000.00 USDT is exactly what INV-0148 is waiting for" is a sentence they
 * can check in two seconds, which is the difference between approving and
 * rubber-stamping.
 */
function PaymentRow({ transfer, payables, proposals, busy, onApprove, onIgnore }: {
  transfer: BoardTransferView
  payables: Payable[]
  proposals: Proposal[]
  busy: boolean
  onApprove: (input: {
    transferId: string
    kind: 'SALE' | 'COMMISSION'
    targetId: string
    amountUsd: number
    basis: 'RULE' | 'AI' | 'HUMAN'
    confidence: number
    reason: string | null
  }) => void
  onIgnore: (reason: string) => void
}) {
  const [manual, setManual] = useState('')
  const [choosing, setChoosing] = useState(false)
  const left = transfer.amountUsd - transfer.linkedUsd

  return (
    <Card className="px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-h3 font-bold tabular-nums text-content-primary">
          {formatUsdt(left)}
        </span>
        <span className="text-caption text-content-secondary">
          {transfer.at.slice(0, 10)} · from {shortAddress(transfer.counterparty)}
          {' · '}{transfer.walletLabel} · {WALLET_CHAIN_LABELS[transfer.chain]}
        </span>
        {transfer.linkedUsd > 0 && (
          <Chip tone="neutral">{formatUsdt(transfer.linkedUsd)} already placed</Chip>
        )}
      </div>

      {proposals.length === 0 ? (
        <p className="mt-2 text-caption text-content-secondary">
          Nothing waiting for this figure. Choose an invoice, or set it aside if it is not ours
          to reconcile.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {proposals.map((proposal) => {
            const payable = payables.find((row) => row.id === proposal.targetId)
            return (
              <li
                key={`${proposal.targetId}:${proposal.amountUsd}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line-subtle bg-surface-subtle px-4 py-3"
              >
                <Chip tone={proposal.confidence >= 85 ? 'success' : 'gold'}>
                  {proposal.confidence}% sure
                </Chip>
                <span className="text-small font-bold text-content-primary">
                  {payable?.reference ?? 'an invoice'}
                </span>
                <span className="text-caption text-content-secondary">{proposal.reason}</span>
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-caption tabular-nums text-content-secondary">
                    {formatUsdt(proposal.amountUsd)}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    icon={<Check className="h-3.5 w-3.5" />}
                    onClick={() => onApprove({
                      transferId: transfer.id,
                      kind: proposal.kind,
                      targetId: proposal.targetId,
                      amountUsd: proposal.amountUsd,
                      // Carried through, so the ledger records whether a
                      // person agreed with a rule or with a model.
                      basis: proposal.confidence <= 75 && proposal.reason.length > 60 ? 'AI' : 'RULE',
                      confidence: proposal.confidence,
                      reason: proposal.reason,
                    })}
                  >
                    Apply
                  </Button>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {choosing ? (
          <>
            <div className="min-w-[280px] flex-1">
              <ComboSelect
                name="payable"
                label="Against which invoice"
                placeholder="An invoice that is waiting"
                /*
                  Open invoices first, and a settled one says so.

                  Both belong in the list — attributing a payment to a sale
                  already marked paid is the point of half of this — but
                  somebody reconciling is nearly always looking for what is
                  owed, and a list that opens on last March's paid invoices
                  is a list they scroll past.
                */
                options={[...payables]
                  .sort((a, b) => Number(Boolean(a.settled)) - Number(Boolean(b.settled)))
                  .map((payable) => ({
                    value: `${payable.kind}:${payable.id}`,
                    label: payable.settled
                      ? `${payable.reference} · ${formatUsdt(payable.totalUsd)} · ${payable.customerName ?? payable.label} · already paid`
                      : `${payable.reference} · ${formatUsdt(payable.dueUsd)} · ${payable.customerName ?? payable.label}`,
                  }))}
                value={manual}
                onChange={setManual}
                emptyMessage="No invoice is waiting."
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={busy || !manual}
              icon={<Link2 className="h-3.5 w-3.5" />}
              onClick={() => {
                const [kind, id] = manual.split(':')
                const payable = payables.find((row) => row.id === id)
                onApprove({
                  transferId: transfer.id,
                  kind: kind as 'SALE' | 'COMMISSION',
                  targetId: id,
                  // The smaller of the two, so linking a large payment to a
                  // small invoice leaves the rest of it on the board rather
                  // than silently over-paying.
                  amountUsd: Math.min(left, payable ? targetUsd(payable) : left),
                  basis: 'HUMAN',
                  confidence: 100,
                  reason: 'Chosen by hand',
                })
                setChoosing(false)
              }}
            >
              Link it
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setChoosing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button type="button" size="sm" variant="secondary" onClick={() => setChoosing(true)}>
              Choose an invoice
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              icon={<X className="h-3.5 w-3.5" />}
              onClick={() => onIgnore('Not ours to reconcile')}
            >
              Set aside
            </Button>
            <a
              href={explorerLink(transfer.chain, transfer.txHash)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-caption text-content-secondary underline hover:text-content-primary"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden /> See it on the chain
            </a>
          </>
        )}
      </div>
    </Card>
  )
}

/**
 * The transaction on a public explorer.
 *
 * The point of reconciling against a chain is that anybody can check it. A
 * link to the block explorer is what turns "the system says this arrived"
 * into something a person can verify in a second, including a customer
 * arguing that they paid.
 */
export function explorerLink(chain: WalletChain, txHash: string): string {
  return chain === 'TRON'
    ? `https://tronscan.org/#/transaction/${txHash}`
    : `https://etherscan.io/tx/${txHash}`
}
