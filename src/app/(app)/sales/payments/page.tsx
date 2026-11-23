import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import { requireCapability } from '@/server/auth/session'
import { loadBoard, listWallets } from '@/server/services/wallet-service'
import { explorerKeyStatus } from '@/server/services/explorer-keys'
import { walletAiConfigured } from '@/server/services/wallet-ai'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, LinkButton } from '@/components/ui'
import { PaymentsBoard } from '@/components/sales/PaymentsBoard'
import { WalletManager } from '@/components/sales/WalletManager'
import { unapplied } from '@/lib/wallet-match'
import type { WalletChain } from '@/lib/enums'

export const metadata: Metadata = { title: 'USDT payments' }
export const dynamic = 'force-dynamic'
export const revalidate = 0
/*
 * Reading two chains is several round trips to a public explorer, and a
 * rate-limited one is read with waits between attempts. The platform default
 * is ten seconds, which kills the request mid-scan and hands the browser a
 * failure with no body — which is why a scan could look like a button that
 * does nothing.
 */
export const maxDuration = 60

/**
 * The money as the chain recorded it, against the invoices it settled.
 *
 * Alex: "we need an inovative way to utilise AI and our USDT wallet addresses
 * the record all transactions, there should be a feature to scan the USDT
 * wallet address and link them to transactions accordingly and flag any other
 * amounts missing or things we should be aware of."
 *
 * It sits under Sales rather than in settings because it is the sales
 * ledger's other half: the invoice says what was owed, this says what
 * arrived. Behind `sale:update`, because deciding which invoice a hundred
 * thousand dollars settled is the same act as marking that invoice paid.
 */
export default async function PaymentsPage() {
  await requireCapability('sale:update')

  const [board, wallets, keys, aiReady] = await Promise.all([
    loadBoard(),
    listWallets(),
    explorerKeyStatus(),
    walletAiConfigured(),
  ])

  const unplacedUsd = board.transfers
    .filter((transfer) => transfer.direction === 'IN' && !transfer.ignoredAt)
    .reduce((sum, transfer) => sum + unapplied(transfer), 0)
  const waitingUsd = board.payables.reduce((sum, payable) => sum + payable.dueUsd, 0)

  return (
    <>
      <PageHeader
        title="USDT payments"
        description="What arrived in our wallets, and the invoices it settled."
        actions={
          <LinkButton href="/sales" variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>
            Sales
          </LinkButton>
        }
      />

      {!aiReady && (
        /*
          Said once, where it matters. The rules work without a key and settle
          the certain cases; Claude is for the leftovers, and somebody
          pressing a button that quietly does nothing deserves to know why.
        */
        <Card className="mb-4 border-line-subtle bg-surface-subtle px-5 py-3">
          <p className="text-caption text-content-secondary">
            No Anthropic key is set, so “Ask Claude about the rest” will have nothing to say.
            The rules below work regardless. A key goes in Settings → Integrations.
          </p>
        </Card>
      )}

      <PaymentsBoard
        transfers={board.transfers.map((transfer) => ({
          id: transfer.id,
          amountUsd: transfer.amountUsd,
          linkedUsd: transfer.linkedUsd ?? 0,
          at: transfer.at,
          counterparty: transfer.counterparty,
          walletLabel: transfer.walletLabel,
          chain: transfer.chain,
          txHash: transfer.txHash,
          direction: transfer.direction,
          ignoredAt: transfer.ignoredAt ? transfer.ignoredAt.toISOString() : null,
          ignoreReason: transfer.ignoreReason,
          links: transfer.links.map((link) => ({
            id: link.id,
            kind: link.kind,
            targetId: link.targetId,
            reference: link.reference,
            customerName: link.customerName,
            label: link.label,
            at: link.at,
            amountUsd: link.amountUsd,
            basis: link.basis,
            confidence: link.confidence,
            reason: link.reason,
            approvedAt: link.approvedAt,
            approvedBy: link.approvedBy,
          })),
        }))}
        payables={board.payables}
        proposals={board.proposals}
        flags={board.flags}
        totals={{
          unplacedUsd,
          waitingUsd,
          scanned: board.lastScan ? board.lastScan.at.toISOString().slice(0, 10) : null,
        }}
      />

      <div className="mt-6">
        <WalletManager
          wallets={wallets.map((wallet) => ({
            id: wallet.id,
            label: wallet.label,
            chain: wallet.chain as WalletChain,
            address: wallet.address,
            isActive: wallet.isActive,
            transfers: Number(wallet.transfers),
            lastSeen: wallet.lastSeen ? String(wallet.lastSeen) : null,
          }))}
          keys={keys.map((key) => ({
            chain: key.chain,
            source: key.source,
            hint: key.hint,
          }))}
        />
      </div>
    </>
  )
}
