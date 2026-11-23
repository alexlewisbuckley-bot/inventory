import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { db, withTransaction } from '../db/client'
import { liveSale } from '../db/predicates'
import {
  brands, brokerages, sales, walletCounterparties, walletLinks, walletScans,
  walletTransfers, wallets, watches,
} from '../db/schema'
import { newId } from '@/lib/ids'
import { recordAudit } from './audit'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { getRateTable } from './fx-service'
import { RATE_SCALE } from '@/lib/currency'
import { normaliseAddress, validAddress } from '@/lib/usdt'
import { BASE_CURRENCY, type WalletChain } from '@/lib/enums'
import {
  flagsFor, proposeLinks, type Flag, type Payable, type Payment, type Proposal,
} from '@/lib/wallet-match'
import { ChainError, directionFor, fetchTransfers } from './chain-reader'
import { logger } from '@/lib/logger'
import type { SessionUser } from '../auth/session'

/**
 * The wallets, what arrived in them, and what it paid for.
 *
 * Alex: "we need an inovative way to utilise AI and our USDT wallet addresses
 * the record all transactions ... and flag any other amounts missing or
 * things we should be aware of."
 *
 * The shape of it follows the Xero reconcile, which is the same job against a
 * worse source: scan, propose, show somebody, write only what they approve.
 * The chain is the better source — it cannot be edited after the fact — so
 * the proposals can be stronger, but the rule that nothing reconciles itself
 * without a person is the same. It is money.
 */

/* -------------------------------------------------------------- wallets -- */

export async function listWallets() {
  return db
    .select({
      id: wallets.id,
      label: wallets.label,
      chain: wallets.chain,
      address: wallets.address,
      isActive: wallets.isActive,
      notes: wallets.notes,
      watchFrom: wallets.watchFrom,
      transfers: sql<number>`(
        SELECT count(*) FROM wallet_transfers t WHERE t.wallet_id = wallets.id
      )`,
      lastSeen: sql<string | null>`(
        SELECT max(t.block_time) FROM wallet_transfers t WHERE t.wallet_id = wallets.id
      )`,
    })
    .from(wallets)
    .where(isNull(wallets.deletedAt))
    .orderBy(wallets.label)
}

export async function saveWallet(input: {
  id?: string | null
  label: string
  chain: WalletChain
  address: string
  watchFrom?: Date | null
  notes?: string | null
  isActive?: boolean
}, actor: SessionUser): Promise<string> {
  const label = input.label.trim()
  if (!label) throw new ValidationError('Give the wallet a name you would recognise.')

  const address = normaliseAddress(input.chain, input.address)
  /*
   * Checked here rather than left to the first scan.
   *
   * An Ethereum address saved as a TRON wallet scans clean for ever and
   * accounts for none of the money — the worst kind of wrong, because every
   * screen says it is working.
   */
  if (!validAddress(input.chain, address)) {
    throw new ValidationError(
      input.chain === 'TRON'
        ? 'A TRON address starts with T and is 34 characters.'
        : 'An Ethereum address starts with 0x and is 42 characters.',
    )
  }

  const [clash] = await db.select({ id: wallets.id }).from(wallets)
    .where(and(
      eq(wallets.chain, input.chain),
      eq(wallets.address, address),
      isNull(wallets.deletedAt),
    ))
    .limit(1)
  if (clash && clash.id !== input.id) {
    throw new ConflictError('That address is already here under another name.')
  }

  if (input.id) {
    await db.update(wallets).set({
      label,
      chain: input.chain,
      address,
      watchFrom: input.watchFrom ?? null,
      notes: input.notes?.trim() || null,
      isActive: input.isActive ?? true,
      updatedAt: new Date(),
    }).where(eq(wallets.id, input.id))
    await recordAudit({
      entityType: 'Wallet', entityId: input.id, action: 'UPDATE', actorId: actor.id,
      summary: `${actor.name} updated the wallet ${label}`,
    })
    return input.id
  }

  const id = newId('wal')
  await db.insert(wallets).values({
    id,
    label,
    chain: input.chain,
    address,
    watchFrom: input.watchFrom ?? null,
    notes: input.notes?.trim() || null,
    isActive: input.isActive ?? true,
    createdById: actor.id,
  })
  await recordAudit({
    entityType: 'Wallet', entityId: id, action: 'CREATE', actorId: actor.id,
    summary: `${actor.name} added the wallet ${label}`,
  })
  return id
}

/** Stop watching a wallet. The transfers it found stay: they are the record. */
export async function removeWallet(id: string, actor: SessionUser): Promise<void> {
  await db.update(wallets)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(wallets.id, id))
  await recordAudit({
    entityType: 'Wallet', entityId: id, action: 'DELETE', actorId: actor.id,
    summary: `${actor.name} stopped watching a wallet`,
  })
}

/* --------------------------------------------------------------- scanning -- */

export interface ScanResult {
  scanId: string
  found: number
  added: number
  errors: Array<{ wallet: string; message: string }>
}

/**
 * Read the chain and keep what is new.
 *
 * Incremental by default: each wallet is read from a little before the newest
 * transfer already stored, because a chain can settle a block out of order
 * and reading from exactly the last one risks stepping over a payment. The
 * overlap costs nothing — a transfer already held is recognised by its own
 * identity and skipped.
 */
export async function scanWallets(
  walletId: string | null, actor: SessionUser,
): Promise<ScanResult> {
  const targets = await db.select().from(wallets).where(and(
    isNull(wallets.deletedAt),
    eq(wallets.isActive, true),
    walletId ? eq(wallets.id, walletId) : undefined,
  ))
  if (targets.length === 0) throw new NotFoundError('Wallet')

  const scanId = newId('scn')
  await db.insert(walletScans).values({
    id: scanId, walletId, status: 'RUNNING', actorId: actor.id,
  })

  let found = 0
  let added = 0
  const errors: ScanResult['errors'] = []

  for (const wallet of targets) {
    try {
      const [newest] = await db
        .select({ at: walletTransfers.blockTime })
        .from(walletTransfers)
        .where(eq(walletTransfers.walletId, wallet.id))
        .orderBy(desc(walletTransfers.blockTime))
        .limit(1)

      // An hour of overlap, for blocks that settle out of order.
      const since = newest?.at
        ? new Date(newest.at.getTime() - 60 * 60 * 1000)
        : wallet.watchFrom ?? null

      const read = await fetchTransfers(wallet.chain as WalletChain, wallet.address, { since })
      found += read.transfers.length
      /*
       * A read cut short by a rate limit is not a failure: what arrived is
       * stored, and it is said rather than swallowed so somebody knows there
       * is more behind it. Scanning again costs nothing — a transfer is
       * recognised by its own content, so the ones already held are skipped.
       */
      if (read.stoppedBy) errors.push({ wallet: wallet.label, message: read.stoppedBy })

      for (const transfer of read.transfers) {
        if (transfer.amountUsd === null) {
          logger.warn('a transfer was skipped: its amount could not be read', {
            chain: wallet.chain, txHash: transfer.txHash,
          })
          continue
        }
        const { direction, counterparty } = directionFor(transfer, wallet.address)
        const result = await db.insert(walletTransfers).values({
          id: newId('wtr'),
          walletId: wallet.id,
          chain: wallet.chain,
          txHash: transfer.txHash,
          direction,
          counterparty,
          amountRaw: transfer.amountRaw,
          amountUsd: transfer.amountUsd,
          tokenSymbol: transfer.symbol,
          contract: transfer.contract,
          blockTime: transfer.blockTime,
          scanId,
          raw: transfer.raw,
        }).onConflictDoNothing().returning({ id: walletTransfers.id })
        if (result.length > 0) added += 1
      }
    } catch (error) {
      const message = error instanceof ChainError || error instanceof Error
        ? error.message
        : String(error)
      errors.push({ wallet: wallet.label, message })
      logger.warn('a wallet could not be scanned', { wallet: wallet.label, message })
    }
  }

  await db.update(walletScans).set({
    status: errors.length === targets.length ? 'FAILED' : 'DONE',
    found,
    added,
    error: errors.length > 0 ? errors.map((e) => `${e.wallet}: ${e.message}`).join(' · ') : null,
    finishedAt: new Date(),
  }).where(eq(walletScans.id, scanId))

  return { scanId, found, added, errors }
}

/* --------------------------------------------------------------- the board -- */

/** How far back the board looks. Older than this is history, not a queue. */
const BOARD_DAYS = 120

/** Base minor units into USDT cents, through the managed rate table. */
function usdFromBase(base: number, usdRate: number): number {
  if (BASE_CURRENCY === 'USD') return base
  return Math.round((base * usdRate) / RATE_SCALE)
}

export interface BoardTransfer extends Payment {
  walletLabel: string
  chain: WalletChain
  txHash: string
  direction: 'IN' | 'OUT'
  tokenSymbol: string
  ignoredAt: Date | null
  ignoreReason: string | null
  links: Array<{
    id: string
    kind: 'SALE' | 'COMMISSION'
    targetId: string
    reference: string
    amountUsd: number
    basis: string
    confidence: number
    reason: string | null
  }>
}

export interface Board {
  transfers: BoardTransfer[]
  payables: Payable[]
  proposals: Proposal[]
  flags: Flag[]
  wallets: Array<{ id: string; label: string; chain: string; address: string }>
  lastScan: { at: Date; found: number; added: number; status: string; error: string | null } | null
}

/**
 * Everything the review screen needs, worked out in one place.
 *
 * Proposals are derived on every read rather than stored. A stored proposal
 * is a guess that goes stale the moment an invoice is paid another way, and
 * the screen would then be arguing for something that is no longer true. Only
 * what somebody approves is written down.
 */
export async function loadBoard(): Promise<Board> {
  const since = new Date(Date.now() - BOARD_DAYS * 24 * 60 * 60 * 1000)
  const rates = await getRateTable()
  const usdRate = rates.USD ?? RATE_SCALE

  const [walletRows, transferRows, linkRows, saleRows, feeRows, counterpartyRows, scanRows] =
    await Promise.all([
      db.select({
        id: wallets.id, label: wallets.label, chain: wallets.chain, address: wallets.address,
      }).from(wallets).where(isNull(wallets.deletedAt)),

      db.select({
        id: walletTransfers.id,
        walletId: walletTransfers.walletId,
        walletLabel: wallets.label,
        chain: walletTransfers.chain,
        txHash: walletTransfers.txHash,
        direction: walletTransfers.direction,
        counterparty: walletTransfers.counterparty,
        amountUsd: walletTransfers.amountUsd,
        tokenSymbol: walletTransfers.tokenSymbol,
        blockTime: walletTransfers.blockTime,
        ignoredAt: walletTransfers.ignoredAt,
        ignoreReason: walletTransfers.ignoreReason,
      })
        .from(walletTransfers)
        .innerJoin(wallets, eq(wallets.id, walletTransfers.walletId))
        .where(gte(walletTransfers.blockTime, since))
        .orderBy(desc(walletTransfers.blockTime))
        .limit(500),

      db.select({
        id: walletLinks.id,
        transferId: walletLinks.transferId,
        saleId: walletLinks.saleId,
        brokerageId: walletLinks.brokerageId,
        amountUsd: walletLinks.amountUsd,
        basis: walletLinks.basis,
        confidence: walletLinks.confidence,
        reason: walletLinks.reason,
        saleInvoice: sales.invoiceNo,
        feeReference: brokerages.reference,
      })
        .from(walletLinks)
        .leftJoin(sales, eq(sales.id, walletLinks.saleId))
        .leftJoin(brokerages, eq(brokerages.id, walletLinks.brokerageId)),

      /*
       * Invoices still waiting. A sale marked paid in full is not on the
       * board: it has been accounted for, by this or by a bank transfer, and
       * a reconciliation screen that lists settled invoices is a screen
       * nobody can see the open ones on.
       */
      db.select({
        id: sales.id,
        reference: sales.invoiceNo,
        base: sales.saleAmountGbp,
        at: sales.saleDate,
        customerId: sales.customerId,
        customerName: sales.customerName,
        brandName: brands.name,
        model: watches.model,
      })
        .from(sales)
        .innerJoin(watches, eq(watches.id, sales.watchId))
        .innerJoin(brands, eq(brands.id, watches.brandId))
        .where(and(
          // The one predicate, so a third way for a sale to stop counting is
          // a single edit rather than a hunt through every query.
          liveSale(),
          gte(sales.saleDate, since),
          inArray(sales.paymentStatus, ['PENDING', 'OVERDUE', 'DEPOSIT']),
        )),

      db.select({
        id: brokerages.id,
        reference: brokerages.reference,
        base: brokerages.feeBase,
        at: brokerages.brokeredOn,
        customerId: brokerages.customerId,
        customerName: brokerages.soldTo,
        description: brokerages.description,
      })
        .from(brokerages)
        .where(and(
          isNull(brokerages.voidedAt),
          isNull(brokerages.deletedAt),
          gte(brokerages.brokeredOn, since),
          inArray(brokerages.paymentStatus, ['PENDING', 'OVERDUE', 'DEPOSIT']),
        )),

      db.select({
        address: walletCounterparties.address,
        customerId: walletCounterparties.customerId,
      }).from(walletCounterparties),

      db.select({
        at: walletScans.startedAt, found: walletScans.found, added: walletScans.added,
        status: walletScans.status, error: walletScans.error,
      }).from(walletScans).orderBy(desc(walletScans.startedAt)).limit(1),
    ])

  const knownCustomer = new Map(
    counterpartyRows.map((row) => [row.address.toLowerCase(), row.customerId]),
  )

  const linksByTransfer = new Map<string, BoardTransfer['links']>()
  const appliedTo = new Map<string, number>()
  for (const link of linkRows) {
    const kind = link.saleId ? 'SALE' as const : 'COMMISSION' as const
    const targetId = link.saleId ?? link.brokerageId ?? ''
    appliedTo.set(targetId, (appliedTo.get(targetId) ?? 0) + link.amountUsd)
    linksByTransfer.set(link.transferId, [
      ...(linksByTransfer.get(link.transferId) ?? []),
      {
        id: link.id,
        kind,
        targetId,
        reference: link.saleInvoice ?? link.feeReference ?? '—',
        amountUsd: link.amountUsd,
        basis: link.basis,
        confidence: link.confidence,
        reason: link.reason,
      },
    ])
  }

  const transfers: BoardTransfer[] = transferRows.map((row) => {
    const links = linksByTransfer.get(row.id) ?? []
    return {
      id: row.id,
      amountUsd: row.amountUsd,
      at: row.blockTime.toISOString(),
      counterparty: row.counterparty,
      knownCustomerId: knownCustomer.get(row.counterparty.toLowerCase()) ?? null,
      linkedUsd: links.reduce((sum, link) => sum + link.amountUsd, 0),
      walletLabel: row.walletLabel,
      chain: row.chain as WalletChain,
      txHash: row.txHash,
      direction: row.direction as 'IN' | 'OUT',
      tokenSymbol: row.tokenSymbol,
      ignoredAt: row.ignoredAt,
      ignoreReason: row.ignoreReason,
      links,
    }
  })

  const payables: Payable[] = [
    ...saleRows.map((row) => {
      const totalUsd = usdFromBase(row.base, usdRate)
      return {
        kind: 'SALE' as const,
        id: row.id,
        reference: row.reference,
        label: `${row.brandName} ${row.model}`.trim(),
        customerId: row.customerId,
        customerName: row.customerName,
        totalUsd,
        dueUsd: Math.max(0, totalUsd - (appliedTo.get(row.id) ?? 0)),
        at: row.at.toISOString(),
      }
    }),
    ...feeRows.map((row) => {
      const totalUsd = usdFromBase(row.base, usdRate)
      return {
        kind: 'COMMISSION' as const,
        id: row.id,
        reference: row.reference ?? '—',
        label: row.description,
        customerId: row.customerId,
        customerName: row.customerName,
        totalUsd,
        dueUsd: Math.max(0, totalUsd - (appliedTo.get(row.id) ?? 0)),
        at: row.at.toISOString(),
      }
    }),
  ]

  /*
   * Only money in, and only what nobody has set aside.
   *
   * Outgoing transfers are kept and shown — a payment to a supplier is worth
   * seeing — but they are not candidates for settling an invoice of ours.
   */
  const open = transfers.filter(
    (transfer) => transfer.direction === 'IN' && !transfer.ignoredAt,
  )
  const proposals = proposeLinks(open, payables)

  const flags = flagsFor({
    payments: open,
    payables,
    proposals,
    ourAddresses: walletRows.map((row) => row.address),
    knownAddresses: [...knownCustomer.keys()],
    now: new Date().toISOString(),
  })

  return {
    transfers,
    payables,
    proposals,
    flags,
    wallets: walletRows,
    lastScan: scanRows[0] ?? null,
  }
}

/* -------------------------------------------------------------- approving -- */

/**
 * Write a link, and settle the invoice if that finishes it.
 *
 * The one place this feature touches the sales ledger. Everything else is
 * reading a public chain and arranging it on a screen; this is the moment a
 * payment becomes a fact about an invoice, so it is a deliberate act by a
 * person and it is audited against the sale.
 */
export async function approveLink(input: {
  transferId: string
  kind: 'SALE' | 'COMMISSION'
  targetId: string
  amountUsd: number
  basis?: 'RULE' | 'AI' | 'HUMAN'
  confidence?: number
  reason?: string | null
}, actor: SessionUser): Promise<string> {
  const [transfer] = await db.select().from(walletTransfers)
    .where(eq(walletTransfers.id, input.transferId)).limit(1)
  if (!transfer) throw new NotFoundError('Transfer')
  if (transfer.direction !== 'IN') {
    throw new ValidationError('That is money going out, not a payment to us.')
  }

  const [existing] = await db
    .select({ total: sql<number>`coalesce(sum(${walletLinks.amountUsd}), 0)` })
    .from(walletLinks)
    .where(eq(walletLinks.transferId, input.transferId))
  const alreadyApplied = Number(existing?.total ?? 0)
  if (input.amountUsd <= 0) throw new ValidationError('Nothing to apply.')
  if (alreadyApplied + input.amountUsd > transfer.amountUsd) {
    throw new ConflictError(
      'That is more than this payment has left. Lower the amount or unlink something first.',
    )
  }

  const id = newId('wlk')
  await withTransaction(async () => {
    await db.insert(walletLinks).values({
      id,
      transferId: input.transferId,
      saleId: input.kind === 'SALE' ? input.targetId : null,
      brokerageId: input.kind === 'COMMISSION' ? input.targetId : null,
      amountUsd: input.amountUsd,
      basis: input.basis ?? 'HUMAN',
      confidence: input.confidence ?? 100,
      reason: input.reason ?? null,
      approvedAt: new Date(),
      approvedById: actor.id,
    })

    await settle(input.kind, input.targetId, transfer.blockTime)

    /*
     * And remember the payer.
     *
     * The second payment from an address is the easiest match in the system,
     * and this is the moment we learn who it belongs to — from somebody
     * agreeing, rather than from a guess.
     */
    const customerId = await customerFor(input.kind, input.targetId)
    await db.insert(walletCounterparties).values({
      id: newId('wcp'),
      chain: transfer.chain,
      address: transfer.counterparty,
      customerId,
      lastSeen: transfer.blockTime,
    }).onConflictDoUpdate({
      target: [walletCounterparties.chain, walletCounterparties.address],
      set: { customerId, lastSeen: transfer.blockTime, updatedAt: new Date() },
    })
  })

  return id
}

/** Who the invoice belongs to, so a payer can be remembered against them. */
async function customerFor(kind: 'SALE' | 'COMMISSION', id: string): Promise<string | null> {
  if (kind === 'SALE') {
    const [row] = await db.select({ customerId: sales.customerId }).from(sales)
      .where(eq(sales.id, id)).limit(1)
    return row?.customerId ?? null
  }
  const [row] = await db.select({ customerId: brokerages.customerId }).from(brokerages)
    .where(eq(brokerages.id, id)).limit(1)
  return row?.customerId ?? null
}

/**
 * What the invoice says once the money is against it.
 *
 * Paid in full where the links cover it, a deposit where they do not. The
 * date is the chain's, not today's: when the money actually arrived is the
 * fact worth keeping, and it is the one a dispute turns on.
 */
async function settle(
  kind: 'SALE' | 'COMMISSION', id: string, paidOn: Date,
): Promise<void> {
  const rates = await getRateTable()
  const usdRate = rates.USD ?? RATE_SCALE

  const [applied] = await db
    .select({ total: sql<number>`coalesce(sum(${walletLinks.amountUsd}), 0)` })
    .from(walletLinks)
    .where(kind === 'SALE' ? eq(walletLinks.saleId, id) : eq(walletLinks.brokerageId, id))
  const paid = Number(applied?.total ?? 0)

  if (kind === 'SALE') {
    const [sale] = await db.select({ base: sales.saleAmountGbp }).from(sales)
      .where(eq(sales.id, id)).limit(1)
    if (!sale) return
    const totalUsd = usdFromBase(sale.base, usdRate)
    await db.update(sales).set({
      paymentStatus: paid >= totalUsd - 100 ? 'PAID' : 'DEPOSIT',
      paidOn: paid >= totalUsd - 100 ? paidOn : null,
      updatedAt: new Date(),
    }).where(eq(sales.id, id))
    return
  }

  const [fee] = await db.select({ base: brokerages.feeBase }).from(brokerages)
    .where(eq(brokerages.id, id)).limit(1)
  if (!fee) return
  const totalUsd = usdFromBase(fee.base, usdRate)
  await db.update(brokerages).set({
    paymentStatus: paid >= totalUsd - 100 ? 'PAID' : 'DEPOSIT',
    updatedAt: new Date(),
  }).where(eq(brokerages.id, id))
}

/** Take a link off again, and put the invoice back where it was. */
export async function unlink(linkId: string, actor: SessionUser): Promise<void> {
  const [link] = await db.select().from(walletLinks).where(eq(walletLinks.id, linkId)).limit(1)
  if (!link) throw new NotFoundError('Link')

  await withTransaction(async () => {
    await db.delete(walletLinks).where(eq(walletLinks.id, linkId))
    const kind = link.saleId ? 'SALE' as const : 'COMMISSION' as const
    const targetId = link.saleId ?? link.brokerageId
    if (targetId) {
      await settle(kind, targetId, new Date())
      // Settling with nothing against it leaves PENDING rather than DEPOSIT.
      const [remaining] = await db
        .select({ total: sql<number>`coalesce(sum(${walletLinks.amountUsd}), 0)` })
        .from(walletLinks)
        .where(kind === 'SALE' ? eq(walletLinks.saleId, targetId) : eq(walletLinks.brokerageId, targetId))
      if (Number(remaining?.total ?? 0) === 0) {
        if (kind === 'SALE') {
          await db.update(sales).set({ paymentStatus: 'PENDING', paidOn: null, updatedAt: new Date() })
            .where(eq(sales.id, targetId))
        } else {
          await db.update(brokerages).set({ paymentStatus: 'PENDING', updatedAt: new Date() })
            .where(eq(brokerages.id, targetId))
        }
      }
    }
  })

  void actor
}

/** Set a transfer aside: our own money moving, a gas top-up, a test ping. */
export async function ignoreTransfer(
  id: string, reason: string, actor: SessionUser,
): Promise<void> {
  await db.update(walletTransfers).set({
    ignoredAt: new Date(),
    ignoredById: actor.id,
    ignoreReason: reason.trim() || 'Not ours to reconcile',
  }).where(eq(walletTransfers.id, id))
}

/** And put it back on the board. */
export async function unignoreTransfer(id: string): Promise<void> {
  await db.update(walletTransfers).set({
    ignoredAt: null, ignoredById: null, ignoreReason: null,
  }).where(eq(walletTransfers.id, id))
}
