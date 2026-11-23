'use server'

import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/server/auth/session'
import { rateLimit, LIMITS } from '@/server/auth/rate-limit'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { WALLET_CHAINS, type WalletChain } from '@/lib/enums'

export interface WalletState {
  ok: boolean
  message: string
  /** Set where an action produced something worth showing straight away. */
  detail?: string
}

const FAILED: WalletState = { ok: false, message: 'That did not work. Please try again.' }

function toState(error: unknown, fallback: string): WalletState {
  if (isAppError(error)) return { ok: false, message: error.message }
  logger.error('a wallet action failed', { error })
  return { ...FAILED, message: fallback }
}

function refresh(): void {
  revalidatePath('/sales/payments')
  revalidatePath('/sales')
}

/**
 * Reading the chain, and what may do it.
 *
 * `sale:update` throughout. Reconciling a payment against an invoice is the
 * same act as marking that invoice paid — it is the sales ledger either way —
 * and giving it a capability of its own would mean a role that cannot correct
 * a sale could still decide which invoice a hundred thousand dollars settled.
 */
export async function scanWalletsAction(walletId?: string | null): Promise<WalletState> {
  const actor = await requireCapability('sale:update')
  // A scan is several outbound requests, so it is limited harder than a write.
  rateLimit({ key: `wallet-scan:${actor.id}`, limit: 10, windowMs: 60_000 })

  try {
    const { scanWallets } = await import('@/server/services/wallet-service')
    const result = await scanWallets(walletId ?? null, actor)
    refresh()

    if (result.errors.length > 0 && result.added === 0) {
      return {
        ok: false,
        message: 'The chain could not be read.',
        detail: result.errors.map((error) => `${error.wallet}: ${error.message}`).join(' · '),
      }
    }

    return {
      ok: true,
      message: result.added === 0
        ? 'Nothing new since the last scan.'
        : `${result.added} new ${result.added === 1 ? 'transfer' : 'transfers'}.`,
      /*
       * The whole message, not a list of wallet names. What stopped a scan
       * is nearly always a rate limit, and the sentence that says so also
       * says what fixes it — which is no use summarised away.
       */
      detail: result.errors.length > 0
        ? result.errors.map((error) => `${error.wallet}: ${error.message}`).join(' · ')
        : undefined,
    }
  } catch (error) {
    return toState(error, 'The wallets could not be scanned.')
  }
}

export async function saveWalletAction(input: {
  id?: string | null
  label: string
  chain: string
  address: string
  watchFrom?: string | null
  notes?: string | null
  isActive?: boolean
}): Promise<WalletState> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })

  if (!WALLET_CHAINS.includes(input.chain as WalletChain)) {
    return { ok: false, message: 'Choose which chain that address is on.' }
  }

  try {
    const { saveWallet } = await import('@/server/services/wallet-service')
    await saveWallet({
      id: input.id,
      label: input.label,
      chain: input.chain as WalletChain,
      address: input.address,
      watchFrom: input.watchFrom ? new Date(input.watchFrom) : null,
      notes: input.notes,
      isActive: input.isActive,
    }, actor)
    refresh()
    return { ok: true, message: 'Saved. Scan it to read what has arrived.' }
  } catch (error) {
    return toState(error, 'That wallet could not be saved.')
  }
}

export async function removeWalletAction(id: string): Promise<WalletState> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  try {
    const { removeWallet } = await import('@/server/services/wallet-service')
    await removeWallet(id, actor)
    refresh()
    // Said rather than assumed: somebody removing a wallet may expect the
    // payments to go with it, and they are the record of money received.
    return { ok: true, message: 'Stopped watching it. The transfers it found stay on the record.' }
  } catch (error) {
    return toState(error, 'That wallet could not be removed.')
  }
}

/** Put a payment against an invoice. The one action here that writes money. */
export async function approveLinkAction(input: {
  transferId: string
  kind: 'SALE' | 'COMMISSION'
  targetId: string
  amountUsd: number
  basis?: 'RULE' | 'AI' | 'HUMAN'
  confidence?: number
  reason?: string | null
}): Promise<WalletState> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  try {
    const { approveLink } = await import('@/server/services/wallet-service')
    await approveLink(input, actor)
    refresh()
    return { ok: true, message: 'Linked. The invoice has been updated.' }
  } catch (error) {
    return toState(error, 'That payment could not be linked.')
  }
}

export async function unlinkAction(linkId: string): Promise<WalletState> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  try {
    const { unlink } = await import('@/server/services/wallet-service')
    await unlink(linkId, actor)
    refresh()
    return { ok: true, message: 'Unlinked. The invoice is waiting again.' }
  } catch (error) {
    return toState(error, 'That link could not be removed.')
  }
}

export async function ignoreTransferAction(
  id: string, reason: string, restore = false,
): Promise<WalletState> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  try {
    const service = await import('@/server/services/wallet-service')
    if (restore) await service.unignoreTransfer(id)
    else await service.ignoreTransfer(id, reason, actor)
    refresh()
    return { ok: true, message: restore ? 'Back on the board.' : 'Set aside.' }
  } catch (error) {
    return toState(error, 'That transfer could not be set aside.')
  }
}

/**
 * Ask Claude about the payments the rules could not place.
 *
 * Deliberately a button rather than something that happens on every page
 * load: it costs money per press, the rules have already done the certain
 * work, and a reconciliation screen that quietly spends on every refresh is
 * one somebody turns off.
 */
export async function askClaudeAction(): Promise<WalletState & {
  proposals?: Array<{
    paymentId: string
    kind: 'SALE' | 'COMMISSION'
    targetId: string
    amountUsd: number
    confidence: number
    reason: string
  }>
  notes?: string[]
}> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `wallet-ai:${actor.id}`, limit: 10, windowMs: 60_000 })

  try {
    const [{ loadBoard }, { readUnmatched }] = await Promise.all([
      import('@/server/services/wallet-service'),
      import('@/server/services/wallet-ai'),
    ])
    const board = await loadBoard()

    // Only what the rules left: the model is not asked to second-guess an
    // exact figure against one waiting invoice.
    const spoken = new Set(board.proposals.map((proposal) => proposal.paymentId))
    const left = board.transfers.filter(
      (transfer) => transfer.direction === 'IN'
        && !transfer.ignoredAt
        && !spoken.has(transfer.id)
        && transfer.amountUsd - (transfer.linkedUsd ?? 0) > 0,
    )
    if (left.length === 0) {
      return { ok: true, message: 'Nothing left for Claude — the rules placed everything.' }
    }

    const reading = await readUnmatched(left, board.payables)
    if (reading.error) return { ok: false, message: reading.error }

    return {
      ok: true,
      message: reading.proposals.length > 0
        ? `Claude placed ${reading.proposals.length} of ${left.length}.`
        : `Claude could not place any of the ${left.length} left.`,
      proposals: reading.proposals,
      notes: reading.notes,
    }
  } catch (error) {
    return toState(error, 'Claude could not be reached.')
  }
}

/** The explorer keys, which are read-only and cannot spend anything. */
export async function saveExplorerKeyAction(
  chain: string, key: string,
): Promise<WalletState> {
  const actor = await requireCapability('sale:update')
  rateLimit({ key: `mutate:${actor.id}`, ...LIMITS.mutation })
  if (!WALLET_CHAINS.includes(chain as WalletChain)) return FAILED

  try {
    const { forgetExplorerKey, saveExplorerKey } = await import('@/server/services/explorer-keys')
    if (!key.trim()) {
      await forgetExplorerKey(chain as WalletChain)
      refresh()
      return { ok: true, message: 'Key removed.' }
    }
    await saveExplorerKey(chain as WalletChain, key, actor)
    refresh()
    return { ok: true, message: 'Key saved. It takes effect on the next scan.' }
  } catch (error) {
    return toState(error, 'That key could not be saved.')
  }
}
